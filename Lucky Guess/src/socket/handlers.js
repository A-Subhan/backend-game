// ============================================================
// Lucky Guess — Socket.IO Event Handlers
// Contoura Labs
//
// Major fixes vs. original:
//  - All connections MUST authenticate via JWT (verifySocketToken
//    middleware registered in src/socket/index.js). The handlers
//    use socket.userId from the JWT — never trust client-supplied
//    payloads.
//  - The draw threshold uses room.max_attempts (was hardcoded 10).
//  - Opponent disconnect now calls forfeitGame() so the remaining
//    player gets the win (ELO + coins + stats + achievements).
//  - Guess result now includes opponentAttempts correctly: the
//    guesser sees the opponent's pre-guess count; the opponent
//    sees the guesser's post-guess count.
//  - Leaving the queue on disconnect always cleans the socket map.
// ============================================================

const { MatchmakingQueue } = require('../services/matchmaking');
const {
  createOnlineRoom,
  processGuess,
  endGame,
  forfeitGame,
} = require('../services/gameService');
const { supabaseAdmin } = require('../config/database');
const {
  SOCKET_EVENTS,
  COINS_WIN,
  COINS_LOSS,
} = require('../../shared/constants');

// In-memory state. For a single-process server this is fine.
// For multi-process, replace with Redis.
const matchmakingQueue = new MatchmakingQueue();
const socketUserMap = new Map();   // socketId -> userId
const userSocketMap = new Map();   // userId -> socketId
const activeRooms = new Map();     // roomId -> room state
const userRoomMap = new Map();     // userId -> roomId

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

    const roomState = {
      roomId: room.id,
      maxAttempts: room.max_attempts,
      player1: { userId: player1.userId, socketId: player1.socketId, userName: player1.userName, attempts: 0 },
      player2: { userId: player2.userId, socketId: player2.socketId, userName: player2.userName, attempts: 0 },
      createdAt: Date.now(),
    };
    activeRooms.set(room.id, roomState);
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

    console.log(`[LuckyGuess Match] Room ${room.id}: ${player1.userName} vs ${player2.userName}`);
  } catch (error) {
    console.error('[LuckyGuess Match] Failed to create room:', error);

    // Re-queue both players
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
 * Register all Socket.IO event handlers on the given io instance
 * (or namespace). JWT auth must already be applied via
 * `io.use(verifySocketToken)` — see src/socket/index.js.
 */
function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    // socket.userId and socket.isGuest are populated by verifySocketToken.
    const userId = socket.userId;
    console.log(`[LuckyGuess Socket] Connected: ${socket.id} (user: ${userId}${socket.isGuest ? ' [guest]' : ''})`);

    // Track socket <-> user mapping (replace any stale socket for this user)
    const previousSocketId = userSocketMap.get(userId);
    if (previousSocketId && previousSocketId !== socket.id) {
      // Force-disconnect the stale socket to avoid duplicate sessions.
      io.sockets.sockets.get(previousSocketId)?.disconnect(true);
    }
    socketUserMap.set(socket.id, userId);
    userSocketMap.set(userId, socket.id);

    // ────────────────────────────────────────────────────────
    // JOIN QUEUE
    // ────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.JOIN_QUEUE, (payload) => {
      // Ignore client-supplied userId — always use the JWT identity.
      const userName = (payload && payload.userName) || `Player_${userId.slice(0, 4)}`;
      const elo = (payload && typeof payload.elo === 'number') ? payload.elo : 1000;

      if (userRoomMap.has(userId)) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'You are already in a game' });
        return;
      }

      matchmakingQueue.remove(userId);

      const player = { userId, userName, elo, socketId: socket.id };
      matchmakingQueue.add(player);

      console.log(`[LuckyGuess Queue] ${userName} (${userId}) joined. Queue size: ${matchmakingQueue.size}`);

      socket.emit(SOCKET_EVENTS.QUEUE_JOINED, {
        message: `Joined queue. ${matchmakingQueue.size} player(s) waiting.`,
      });

      const match = matchmakingQueue.tryMatch();
      if (match) {
        handleMatchFound(io, match);
      }
    });

    // ────────────────────────────────────────────────────────
    // LEAVE QUEUE
    // ────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.LEAVE_QUEUE, () => {
      const removed = matchmakingQueue.remove(userId);
      if (removed) {
        console.log(`[LuckyGuess Queue] ${removed.userName} (${userId}) left queue.`);
      }
    });

    // ────────────────────────────────────────────────────────
    // SUBMIT GUESS
    // ────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.SUBMIT_GUESS, async (payload) => {
      const { roomId, guess } = payload || {};
      if (!roomId || typeof guess !== 'number') {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Invalid guess payload' });
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

      const opponentSocketId = isPlayer1
        ? room.player2.socketId
        : room.player1.socketId;
      const opponentAttemptsBefore = isPlayer1
        ? room.player2.attempts
        : room.player1.attempts;

      try {
        const outcome = await processGuess(roomId, userId, guess);

        // Increment in-memory attempt counter for the guesser.
        if (isPlayer1) room.player1.attempts += 1;
        else room.player2.attempts += 1;

        const guesserAttempts = isPlayer1
          ? room.player1.attempts
          : room.player2.attempts;

        // Send guess_result to BOTH players.
        // The guesser sees the opponent's pre-guess count.
        // The opponent sees the guesser's post-guess count.
        socket.emit(SOCKET_EVENTS.GUESS_RESULT, {
          result: outcome.result,
          attemptsLeft: outcome.attemptsLeft,
          opponentAttempts: opponentAttemptsBefore,
        });

        if (opponentSocketId) {
          io.to(opponentSocketId).emit(SOCKET_EVENTS.GUESS_RESULT, {
            result: outcome.result,
            attemptsLeft: outcome.attemptsLeft,
            opponentAttempts: guesserAttempts,
          });
        }

        // ── Correct guess → game over ──
        if (outcome.isCorrect) {
          const winnerId = userId;
          const loserId = isPlayer1 ? room.player2.userId : room.player1.userId;

          try {
            const gameResult = await endGame(roomId, winnerId, loserId, guesserAttempts);

            socket.emit(SOCKET_EVENTS.GAME_OVER, {
              winner: winnerId,
              coins: gameResult.coinsAwarded,
              eloChange: gameResult.winnerEloChange,
              matchId: gameResult.matchId,
            });

            if (opponentSocketId) {
              io.to(opponentSocketId).emit(SOCKET_EVENTS.GAME_OVER, {
                winner: winnerId,
                coins: gameResult.coinsLost,
                eloChange: gameResult.loserEloChange,
                matchId: gameResult.matchId,
              });
            }

            cleanupRoom(roomId);
            console.log(`[LuckyGuess Game] Room ${roomId} ended. Winner: ${winnerId}`);
          } catch (endError) {
            console.error(`[LuckyGuess Game] endGame failed for room ${roomId}:`, endError);
            socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to finalize game' });
            if (opponentSocketId) {
              io.to(opponentSocketId).emit(SOCKET_EVENTS.ERROR, { message: 'Failed to finalize game' });
            }
          }
          return;
        }

        // ── Draw: both players exhausted their attempts ──
        if (
          outcome.attemptsLeft === 0 &&
          room.player1.attempts >= room.maxAttempts &&
          room.player2.attempts >= room.maxAttempts
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
          console.log(`[LuckyGuess Game] Room ${roomId} ended in a draw.`);
        }
      } catch (guessError) {
        const message = guessError instanceof Error ? guessError.message : 'Guess failed';
        socket.emit(SOCKET_EVENTS.ERROR, { message });
      }
    });

    // ────────────────────────────────────────────────────────
    // FORFEIT
    // ────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.FORFEIT, async (payload) => {
      const { roomId } = payload || {};
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

        // Forfeiter gets no coins.
        socket.emit(SOCKET_EVENTS.GAME_OVER, {
          winner: gameResult.winnerId,
          coins: 0,
          eloChange: gameResult.loserEloChange,
          matchId: gameResult.matchId,
        });

        // Winner gets the win bonus.
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

    // ────────────────────────────────────────────────────────
    // DISCONNECT
    // ────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      socketUserMap.delete(socket.id);
      // Only clear userSocketMap if it still points to THIS socket.
      if (userSocketMap.get(userId) === socket.id) {
        userSocketMap.delete(userId);
      }
      matchmakingQueue.remove(userId);

      const roomId = userRoomMap.get(userId);
      if (roomId) {
        const room = activeRooms.get(roomId);
        if (room) {
          const opponentUserId = room.player1.userId === userId
            ? room.player2.userId
            : room.player1.userId;
          const opponentSocketId = room.player1.userId === userId
            ? room.player2.socketId
            : room.player1.socketId;

          // Mark the room abandoned in the DB (fire-and-forget).
          try {
            await supabaseAdmin
              .from('rooms')
              .update({ status: 'abandoned' })
              .eq('id', roomId);
          } catch (err) {
            console.error('[LuckyGuess] Failed to mark room abandoned:', err);
          }

          // Award the win to the opponent.
          try {
            const gameResult = await forfeitGame(roomId, userId);

            if (opponentSocketId) {
              io.to(opponentSocketId).emit(SOCKET_EVENTS.OPPONENT_DISCONNECTED, {
                message: 'Your opponent disconnected. You win!',
                coins: gameResult.coinsAwarded,
              });
              io.to(opponentSocketId).emit(SOCKET_EVENTS.GAME_OVER, {
                winner: gameResult.winnerId,
                coins: gameResult.coinsAwarded,
                eloChange: gameResult.winnerEloChange,
                matchId: gameResult.matchId,
              });
            }
          } catch (err) {
            console.error(`[LuckyGuess] Failed to award win on disconnect for room ${roomId}:`, err);
            if (opponentSocketId) {
              io.to(opponentSocketId).emit(SOCKET_EVENTS.OPPONENT_DISCONNECTED, {
                message: 'Your opponent disconnected.',
                coins: COINS_WIN,
              });
            }
          }

          cleanupRoom(roomId);
          console.log(`[LuckyGuess Socket] ${userId} disconnected (${reason}). Room ${roomId} awarded to opponent ${opponentUserId}.`);
        }
      }

      console.log(`[LuckyGuess Socket] Disconnected: ${socket.id} (user: ${userId}) — ${reason}`);
    });
  });
}

module.exports = { registerSocketHandlers };
