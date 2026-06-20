// ============================================================
// Lucky Guess — Socket.IO Event Handlers
// Contoura Labs
// ============================================================

const { MatchmakingQueue } = require('../services/matchmaking');
const { createOnlineRoom, processGuess, endGame, forfeitGame } = require('../services/gameService');
const { supabaseAdmin } = require('../config/database');
const { SOCKET_EVENTS, COINS_LOSS } = require('../../shared/constants');

/**
 * In-memory state for tracking active games and socket→user mappings.
 */
const matchmakingQueue = new MatchmakingQueue();
const socketUserMap = new Map();
const userSocketMap = new Map();
const activeRooms = new Map();
const userRoomMap = new Map();

function cleanupRoom(roomId) {
  const room = activeRooms.get(roomId);
  if (room) {
    userRoomMap.delete(room.player1.userId);
    userRoomMap.delete(room.player2.userId);
    activeRooms.delete(roomId);
  }
}

async function handleMatchFound(io, match) {
  try {
    const { player1, player2 } = match;

    const room = await createOnlineRoom(
      player1.userId,
      player1.userName,
      player2.userId,
      player2.userName
    );

    activeRooms.set(room.id, {
      roomId: room.id,
      player1: { userId: player1.userId, socketId: player1.socketId, attempts: 0 },
      player2: { userId: player2.userId, socketId: player2.socketId, attempts: 0 },
      createdAt: Date.now(),
    });

    userRoomMap.set(player1.userId, room.id);
    userRoomMap.set(player2.userId, room.id);

    io.to(player1.socketId).emit(SOCKET_EVENTS.MATCH_FOUND, {
      room,
      opponentName: player2.userName,
    });

    io.to(player2.socketId).emit(SOCKET_EVENTS.MATCH_FOUND, {
      room,
      opponentName: player1.userName,
    });

    console.log(`[LuckyGuess Match] Created room ${room.id}: ${player1.userName} vs ${player2.userName}`);
  } catch (error) {
    console.error('[LuckyGuess Match] Failed to create room:', error);

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

    io.to(match.player1.socketId).emit(SOCKET_EVENTS.ERROR, {
      message: 'Failed to create game room. Re-queued.',
    });
    io.to(match.player2.socketId).emit(SOCKET_EVENTS.ERROR, {
      message: 'Failed to create game room. Re-queued.',
    });
  }
}

/**
 * Register all Socket.IO event handlers on a given io instance (or namespace).
 */
function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[LuckyGuess Socket] Connected: ${socket.id}`);

    // ────────────────────────────────────────────────────────────
    // JOIN QUEUE
    // ────────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.JOIN_QUEUE, (payload) => {
      const { userId, userName, elo } = payload;

      if (!userId || !userName) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Invalid queue payload' });
        return;
      }

      if (userRoomMap.has(userId)) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'You are already in a game' });
        return;
      }

      socketUserMap.set(socket.id, userId);
      userSocketMap.set(userId, socket.id);
      matchmakingQueue.remove(userId);

      const player = {
        userId,
        userName,
        elo: elo || 1000,
        socketId: socket.id,
      };

      matchmakingQueue.add(player);

      console.log(`[LuckyGuess Queue] Player ${userName} (${userId}) joined. Queue: ${matchmakingQueue.size}`);

      socket.emit(SOCKET_EVENTS.QUEUE_JOINED, {
        message: `Joined queue. ${matchmakingQueue.size} player(s) waiting.`,
      });

      const match = matchmakingQueue.tryMatch();
      if (match) {
        handleMatchFound(io, match);
      }
    });

    // ────────────────────────────────────────────────────────────
    // LEAVE QUEUE
    // ────────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.LEAVE_QUEUE, (payload) => {
      const { userId } = payload;
      const removed = matchmakingQueue.remove(userId);
      if (removed) {
        console.log(`[LuckyGuess Queue] Player ${removed.userName} (${userId}) left queue.`);
      }
    });

    // ────────────────────────────────────────────────────────────
    // SUBMIT GUESS
    // ────────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.SUBMIT_GUESS, async (payload) => {
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

      const isPlayer1 = room.player1.userId === userId;
      const isPlayer2 = room.player2.userId === userId;

      if (!isPlayer1 && !isPlayer2) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'You are not in this room' });
        return;
      }

      const opponentSocketId = isPlayer1 ? room.player2.socketId : room.player1.socketId;
      const opponentAttempts = isPlayer1 ? room.player2.attempts : room.player1.attempts;

      try {
        const outcome = await processGuess(roomId, userId, guess);

        if (isPlayer1) {
          room.player1.attempts++;
        } else {
          room.player2.attempts++;
        }

        socket.emit(SOCKET_EVENTS.GUESS_RESULT, {
          result: outcome.result,
          attemptsLeft: outcome.attemptsLeft,
          opponentAttempts,
        });

        if (opponentSocketId) {
          const guesserAttempts = isPlayer1 ? room.player1.attempts : room.player2.attempts;
          io.to(opponentSocketId).emit(SOCKET_EVENTS.GUESS_RESULT, {
            result: outcome.result,
            attemptsLeft: outcome.attemptsLeft,
            opponentAttempts: guesserAttempts,
          });
        }

        if (outcome.isCorrect) {
          const winnerId = userId;
          const loserId = isPlayer1 ? room.player2.userId : room.player1.userId;
          const winnerAttempts = isPlayer1 ? room.player1.attempts : room.player2.attempts;

          try {
            const gameResult = await endGame(roomId, winnerId, loserId, winnerAttempts);

            socket.emit(SOCKET_EVENTS.GAME_OVER, {
              winner: winnerId,
              coins: gameResult.coinsAwarded,
              eloChange: gameResult.winnerEloChange,
              matchId: gameResult.matchId,
            });

            if (opponentSocketId) {
              io.to(opponentSocketId).emit(SOCKET_EVENTS.GAME_OVER, {
                winner: winnerId,
                coins: COINS_LOSS,
                eloChange: gameResult.loserEloChange,
                matchId: gameResult.matchId,
              });
            }

            cleanupRoom(roomId);
            console.log(`[LuckyGuess Game] Room ${roomId} ended. Winner: ${winnerId}`);
          } catch (endError) {
            console.error(`[LuckyGuess Game] Failed to end game for room ${roomId}:`, endError);
            socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to finalize game' });
          }
        }

        // Check if both players used all attempts — draw
        if (
          !outcome.isCorrect &&
          outcome.attemptsLeft === 0 &&
          room.player1.attempts >= 10 &&
          room.player2.attempts >= 10
        ) {
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
      } catch (guessError) {
        const message = guessError instanceof Error ? guessError.message : 'Guess failed';
        socket.emit(SOCKET_EVENTS.ERROR, { message });
      }
    });

    // ────────────────────────────────────────────────────────────
    // FORFEIT
    // ────────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.FORFEIT, async (payload) => {
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
        const gameResult = await forfeitGame(roomId, userId);

        socket.emit(SOCKET_EVENTS.GAME_OVER, {
          winner: gameResult.winnerId,
          coins: 0,
          eloChange: gameResult.loserEloChange,
          matchId: gameResult.matchId,
        });

        if (opponentSocketId) {
          io.to(opponentSocketId).emit(SOCKET_EVENTS.GAME_OVER, {
            winner: gameResult.winnerId,
            coins: gameResult.coinsAwarded,
            eloChange: gameResult.winnerEloChange,
            matchId: gameResult.matchId,
          });
        }

        cleanupRoom(roomId);
        console.log(`[LuckyGuess Game] Player ${userId} forfeited room ${roomId}`);
      } catch (forfeitError) {
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
        matchmakingQueue.remove(userId);
        userSocketMap.delete(userId);
        socketUserMap.delete(socket.id);

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

            supabaseAdmin
              .from('rooms')
              .update({ status: 'abandoned' })
              .eq('id', roomId)
              .catch(err => console.error('Failed to mark room abandoned:', err));

            cleanupRoom(roomId);
            console.log(`[LuckyGuess Game] Player ${userId} disconnected from room ${roomId}`);
          }
        }

        console.log(`[LuckyGuess Socket] Disconnected: ${socket.id} (user: ${userId})`);
      } else {
        console.log(`[LuckyGuess Socket] Disconnected: ${socket.id}`);
      }
    });
  });
}

module.exports = { registerSocketHandlers };