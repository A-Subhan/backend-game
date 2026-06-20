// ============================================================
// Lucky Guess — Socket.IO Event Handlers
// Contoura Labs
// ============================================================

import { Server, Socket } from 'socket.io';
import { MatchmakingQueue, QueuedPlayer } from '../services/matchmaking';
import { createOnlineRoom, processGuess, endGame, forfeitGame, GuessOutcome, EndGameResult } from '../services/gameService';
import { supabaseAdmin } from '../config/database';
import { SOCKET_EVENTS, COINS_LOSS } from '@shared/constants';
import { Room } from '@shared/types';

/**
 * In-memory state for tracking active games and socket→user mappings.
 */
interface ActiveRoom {
  roomId: string;
  player1: { userId: string; socketId: string; attempts: number };
  player2: { userId: string; socketId: string; attempts: number };
  createdAt: number;
}

const matchmakingQueue = new MatchmakingQueue();

/**
 * Map socket.id → userId for quick lookup on disconnect.
 */
const socketUserMap = new Map<string, string>();

/**
 * Map userId → socket.id for sending events to specific users.
 */
const userSocketMap = new Map<string, string>();

/**
 * Active rooms keyed by roomId.
 */
const activeRooms = new Map<string, ActiveRoom>();

/**
 * Map userId → roomId for quick lookup of a user's active game.
 */
const userRoomMap = new Map<string, string>();

/**
 * Clean up an active room from memory.
 */
function cleanupRoom(roomId: string): void {
  const room = activeRooms.get(roomId);
  if (room) {
    userRoomMap.delete(room.player1.userId);
    userRoomMap.delete(room.player2.userId);
    activeRooms.delete(roomId);
  }
}

/**
 * Handle a successful match — create the room and notify both players.
 */
async function handleMatchFound(
  io: Server,
  match: { player1: QueuedPlayer; player2: QueuedPlayer }
): Promise<void> {
  try {
    const { player1, player2 } = match;

    const room: Room = await createOnlineRoom(
      player1.userId,
      player1.userName,
      player2.userId,
      player2.userName
    );

    // Track the active room
    activeRooms.set(room.id, {
      roomId: room.id,
      player1: { userId: player1.userId, socketId: player1.socketId, attempts: 0 },
      player2: { userId: player2.userId, socketId: player2.socketId, attempts: 0 },
      createdAt: Date.now(),
    });

    userRoomMap.set(player1.userId, room.id);
    userRoomMap.set(player2.userId, room.id);

    // Notify player 1
    io.to(player1.socketId).emit(SOCKET_EVENTS.MATCH_FOUND, {
      room,
      opponentName: player2.userName,
    });

    // Notify player 2
    io.to(player2.socketId).emit(SOCKET_EVENTS.MATCH_FOUND, {
      room,
      opponentName: player1.userName,
    });

    console.log(`[Match] Created room ${room.id}: ${player1.userName} vs ${player2.userName}`);
  } catch (error) {
    console.error('[Match] Failed to create room:', error);

    // Put players back in the queue
    matchmakingQueue.add({
      userId: match.player1.userId,
      userName: match.player1.userName,
      elo: match.player1.elo,
      socketId: match.player1.socketId,
    });
    matchmakingQueue.add({
      userId: match.player2.userId,
      userName: match.player2.userName,
      elo: match.player2.elo,
      socketId: match.player2.socketId,
    });

    // Notify both of the error
    io.to(match.player1.socketId).emit(SOCKET_EVENTS.ERROR, {
      message: 'Failed to create game room. Re-queued.',
    });
    io.to(match.player2.socketId).emit(SOCKET_EVENTS.ERROR, {
      message: 'Failed to create game room. Re-queued.',
    });
  }
}

/**
 * Register all Socket.IO event handlers.
 */
export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ────────────────────────────────────────────────────────────
    // JOIN QUEUE
    // ────────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.JOIN_QUEUE, (payload: { userId: string; userName: string; elo: number }) => {
      const { userId, userName, elo } = payload;

      if (!userId || !userName) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Invalid queue payload' });
        return;
      }

      // If already in a room, don't allow queueing
      if (userRoomMap.has(userId)) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'You are already in a game' });
        return;
      }

      // Store socket↔user mapping
      socketUserMap.set(socket.id, userId);
      userSocketMap.set(userId, socket.id);

      // Remove any previous queue entry for this user (e.g., reconnected)
      matchmakingQueue.remove(userId);

      // Add to matchmaking queue
      const player: Omit<QueuedPlayer, 'joinedAt'> = {
        userId,
        userName,
        elo: elo || 1000,
        socketId: socket.id,
      };

      matchmakingQueue.add(player);

      console.log(`[Queue] Player ${userName} (${userId}) joined queue. Queue size: ${matchmakingQueue.size}`);

      socket.emit(SOCKET_EVENTS.QUEUE_JOINED, {
        message: `Joined queue. ${matchmakingQueue.size} player(s) waiting.`,
      });

      // Attempt to find a match immediately
      const match = matchmakingQueue.tryMatch();

      if (match) {
        handleMatchFound(io, match);
      }
    });

    // ────────────────────────────────────────────────────────────
    // LEAVE QUEUE
    // ────────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.LEAVE_QUEUE, (payload: { userId: string }) => {
      const { userId } = payload;

      const removed = matchmakingQueue.remove(userId);
      if (removed) {
        console.log(`[Queue] Player ${removed.userName} (${userId}) left queue.`);
      }
    });

    // ────────────────────────────────────────────────────────────
    // SUBMIT GUESS
    // ────────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.SUBMIT_GUESS, async (payload: { roomId: string; guess: number }) => {
      const { roomId, guess } = payload;
      const userId = socketUserMap.get(socket.id);

      if (!userId) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Not authenticated' });
        return;
      }

      const room = activeRooms.get(roomId);
      if (!room) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Room not found' });
        return;
      }

      // Verify this player is in the room
      const isPlayer1 = room.player1.userId === userId;
      const isPlayer2 = room.player2.userId === userId;

      if (!isPlayer1 && !isPlayer2) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'You are not in this room' });
        return;
      }

      // Get the opponent's socket for sending opponent attempts
      const opponentSocketId = isPlayer1 ? room.player2.socketId : room.player1.socketId;
      const opponentAttempts = isPlayer1 ? room.player2.attempts : room.player1.attempts;

      try {
        const outcome: GuessOutcome = await processGuess(roomId, userId, guess);

        // Update local tracking
        if (isPlayer1) {
          room.player1.attempts++;
        } else {
          room.player2.attempts++;
        }

        // Send result to the guessing player
        socket.emit(SOCKET_EVENTS.GUESS_RESULT, {
          result: outcome.result,
          attemptsLeft: outcome.attemptsLeft,
          opponentAttempts,
        });

        // Notify opponent of the opponent's attempt count
        if (opponentSocketId) {
          const guesserAttempts = isPlayer1 ? room.player1.attempts : room.player2.attempts;
          io.to(opponentSocketId).emit(SOCKET_EVENTS.GUESS_RESULT, {
            result: outcome.result,
            attemptsLeft: outcome.attemptsLeft,
            opponentAttempts: guesserAttempts,
          });
        }

        // If correct, end the game
        if (outcome.isCorrect) {
          const winnerId = userId;
          const loserId = isPlayer1 ? room.player2.userId : room.player1.userId;
          const winnerAttempts = isPlayer1 ? room.player1.attempts : room.player2.attempts;

          try {
            const gameResult: EndGameResult = await endGame(
              roomId,
              winnerId,
              loserId,
              winnerAttempts
            );

            // Notify winner
            socket.emit(SOCKET_EVENTS.GAME_OVER, {
              winner: winnerId,
              coins: gameResult.coinsAwarded,
              eloChange: gameResult.winnerEloChange,
              matchId: gameResult.matchId,
            });

            // Notify loser
            if (opponentSocketId) {
              io.to(opponentSocketId).emit(SOCKET_EVENTS.GAME_OVER, {
                winner: winnerId,
                coins: COINS_LOSS,
                eloChange: gameResult.loserEloChange,
                matchId: gameResult.matchId,
              });
            }

            // Clean up room
            cleanupRoom(roomId);

            console.log(`[Game] Room ${roomId} ended. Winner: ${winnerId}`);
          } catch (endError) {
            console.error(`[Game] Failed to end game for room ${roomId}:`, endError);
            socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to finalize game' });
          }
        }

        // Check if both players used all attempts — it's a draw (both lose, no ELO change)
        if (
          !outcome.isCorrect &&
          outcome.attemptsLeft === 0 &&
          room.player1.attempts >= 10 &&
          room.player2.attempts >= 10
        ) {
          // Both exhausted attempts, nobody wins
          await supabaseAdmin
            .from('rooms')
            .update({ status: 'finished' })
            .eq('id', roomId);

          socket.emit(SOCKET_EVENTS.GAME_OVER, {
            winner: 'draw',
            coins: COINS_LOSS,
            eloChange: 0,
            matchId: '',
          });

          if (opponentSocketId) {
            io.to(opponentSocketId).emit(SOCKET_EVENTS.GAME_OVER, {
              winner: 'draw',
              coins: COINS_LOSS,
              eloChange: 0,
              matchId: '',
            });
          }

          cleanupRoom(roomId);
        }
      } catch (guessError: unknown) {
        const message = guessError instanceof Error ? guessError.message : 'Guess failed';
        socket.emit(SOCKET_EVENTS.ERROR, { message });
      }
    });

    // ────────────────────────────────────────────────────────────
    // FORFEIT
    // ────────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.FORFEIT, async (payload: { roomId: string }) => {
      const { roomId } = payload;
      const userId = socketUserMap.get(socket.id);

      if (!userId) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Not authenticated' });
        return;
      }

      const room = activeRooms.get(roomId);
      if (!room) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Room not found' });
        return;
      }

      const opponentSocketId = room.player1.userId === userId
        ? room.player2.socketId
        : room.player1.socketId;

      try {
        const gameResult: EndGameResult = await forfeitGame(roomId, userId);

        // Notify forfeiter (loser)
        socket.emit(SOCKET_EVENTS.GAME_OVER, {
          winner: gameResult.winnerId,
          coins: 0,
          eloChange: gameResult.loserEloChange,
          matchId: gameResult.matchId,
        });

        // Notify opponent (winner)
        if (opponentSocketId) {
          io.to(opponentSocketId).emit(SOCKET_EVENTS.GAME_OVER, {
            winner: gameResult.winnerId,
            coins: gameResult.coinsAwarded,
            eloChange: gameResult.winnerEloChange,
            matchId: gameResult.matchId,
          });
        }

        cleanupRoom(roomId);

        console.log(`[Game] Player ${userId} forfeited room ${roomId}`);
      } catch (forfeitError: unknown) {
        const message = forfeitError instanceof Error ? forfeitError.message : 'Forfeit failed';
        socket.emit(SOCKET_EVENTS.ERROR, { message });
      }
    });

    // ────────────────────────────────────────────────────────────
    // DISCONNECT
    // ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const userId = socketUserMap.get(socket.id);

      if (userId) {
        // Remove from matchmaking queue
        matchmakingQueue.remove(userId);

        // Clean up socket↔user maps
        userSocketMap.delete(userId);
        socketUserMap.delete(socket.id);

        // If user was in an active room, notify opponent
        const roomId = userRoomMap.get(userId);
        if (roomId) {
          const room = activeRooms.get(roomId);
          if (room) {
            const opponentSocketId = room.player1.userId === userId
              ? room.player2.socketId
              : room.player1.socketId;

            if (opponentSocketId) {
              io.to(opponentSocketId).emit(SOCKET_EVENTS.OPPONENT_DISCONNECTED, {
                message: 'Your opponent disconnected',
                coins: COINS_LOSS,
              });
            }

            // Mark room as abandoned in DB
            supabaseAdmin
              .from('rooms')
              .update({ status: 'abandoned' })
              .eq('id', roomId)
              .then(() => {
                // Room marked abandoned
              })
              .catch((err: Error) => console.error('Failed to mark room abandoned:', err));

            cleanupRoom(roomId);

            console.log(`[Game] Player ${userId} disconnected from room ${roomId}`);
          }
        }

        console.log(`[Socket] Disconnected: ${socket.id} (user: ${userId})`);
      } else {
        console.log(`[Socket] Disconnected: ${socket.id}`);
      }
    });
  });
}