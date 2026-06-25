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
//
// Bot opponent system:
//  - If no real opponent is found within BOT_MATCH_DELAY (8 s),
//    the player is automatically matched with "LuckyBot".
//  - The bot uses a binary-search strategy with small random
//    offsets so it is beatable but not trivially easy.
//  - Bot games award coins to the winner but do NOT affect ELO
//    or create match-history records (the bot is not a real user).
// ============================================================

const { MatchmakingQueue } = require('../services/matchmaking');
const {
  createOnlineRoom,
  processGuess,
  endGame,
  forfeitGame,
} = require('../services/gameService');
const { supabaseAdmin } = require('../config/database');
const { awardCoins } = require('../services/coinService');
const {
  SOCKET_EVENTS,
  COINS_WIN,
  COINS_LOSS,
} = require('../../shared/constants');

// ── In-memory state. For a single-process server this is fine.
//    For multi-process, replace with Redis. ─────────────────
const matchmakingQueue = new MatchmakingQueue();
const socketUserMap = new Map();   // socketId -> userId
const userSocketMap = new Map();   // userId -> socketId
const activeRooms = new Map();     // roomId -> room state
const userRoomMap = new Map();     // userId -> roomId

// ── Bot opponent state ────────────────────────────────────
const BOT_PLAYER_ID   = 'bot-system';
const BOT_PLAYER_NAME = 'LuckyBot';
const BOT_MATCH_DELAY = 8000;           // 8 seconds
const BOT_GUESS_DELAY_MIN = 2000;      // 2 s
const BOT_GUESS_DELAY_MAX = 5000;      // 5 s
const botMatchTimeouts = new Map();    // userId -> NodeJS.Timeout
const botGuessTimers   = new Map();    // roomId  -> NodeJS.Timeout
const playerQueueInfo  = new Map();    // userId -> { userName, elo, socketId }

function cleanupRoom(roomId) {
  const room = activeRooms.get(roomId);
  if (room) {
    userRoomMap.delete(room.player1.userId);
    if (!room.isBotGame) {
      userRoomMap.delete(room.player2.userId);
    }
    activeRooms.delete(roomId);
  }
}

function clearBotGuessTimer(roomId) {
  const t = botGuessTimers.get(roomId);
  if (t) {
    clearTimeout(t);
    botGuessTimers.delete(roomId);
  }
}

function clearBotMatchTimeout(userId) {
  const t = botMatchTimeouts.get(userId);
  if (t) {
    clearTimeout(t);
    botMatchTimeouts.delete(userId);
  }
}

// ─────────────────────────────────────────────────────────
// BOT OPPONENT
// ─────────────────────────────────────────────────────────

/**
 * Match a real player against the bot.
 * Creates a DB room (processGuess needs it) but handles game-over
 * without calling endGame (bot has no users-row).
 */
async function handleBotMatch(io, userId, socketId, userName) {
  try {
    const room = await createOnlineRoom(
      userId, userName,
      BOT_PLAYER_ID, BOT_PLAYER_NAME,
    );

    const roomState = {
      roomId: room.id,
      maxAttempts: room.max_attempts,
      isBotGame: true,
      player1: { userId, socketId, userName, attempts: 0 },
      player2: {
        userId: BOT_PLAYER_ID,
        socketId: null,
        userName: BOT_PLAYER_NAME,
        attempts: 0,
      },
      botMin: room.min_number,
      botMax: room.max_number,
      createdAt: Date.now(),
    };

    activeRooms.set(room.id, roomState);
    userRoomMap.set(userId, room.id);
    // No userRoomMap entry for the bot

    io.to(socketId).emit(SOCKET_EVENTS.MATCH_FOUND, {
      room,
      opponentName: BOT_PLAYER_NAME,
    });

    console.log(
      `[LuckyGuess Bot] Matched ${userName} with bot in room ${room.id}`,
    );

    // Start bot guessing after a short delay
    scheduleBotGuess(io, room.id);
  } catch (error) {
    console.error('[LuckyGuess Bot] Failed to create bot room:', error);
    io.to(socketId).emit(SOCKET_EVENTS.ERROR, {
      message: 'Failed to start bot game. Please try again.',
    });
  }
}

/**
 * Schedule the next bot guess at a random interval.
 */
function scheduleBotGuess(io, roomId) {
  const delay =
    BOT_GUESS_DELAY_MIN +
    Math.random() * (BOT_GUESS_DELAY_MAX - BOT_GUESS_DELAY_MIN);

  const timer = setTimeout(() => {
    makeBotGuess(io, roomId);
  }, delay);

  botGuessTimers.set(roomId, timer);
}

/**
 * The bot makes a guess using a binary-search strategy with small
 * random offsets so it is beatable but not trivially easy.
 */
async function makeBotGuess(io, roomId) {
  const room = activeRooms.get(roomId);
  if (!room || !room.isBotGame) return;

  const bot = room.player2;

  // Bot exhausted attempts — check for draw
  if (bot.attempts >= room.maxAttempts) {
    if (room.player1.attempts >= room.maxAttempts) {
      // Both exhausted → draw
      io.to(room.player1.socketId).emit(SOCKET_EVENTS.GAME_OVER, {
        winner: 'draw',
        coins: 0,
        eloChange: 0,
        isBotGame: true,
      });
      await markRoomFinished(roomId);
      clearBotGuessTimer(roomId);
      cleanupRoom(roomId);
    }
    // Otherwise the real player still has attempts — do nothing.
    return;
  }

  // ── Calculate guess (binary search + random jitter) ──
  const range = room.botMax - room.botMin + 1;
  let guess;
  if (range <= 1) {
    guess = room.botMin;
  } else {
    const mid = Math.floor((room.botMin + room.botMax) / 2);
    const jitter = Math.floor(
      Math.random() * Math.min(Math.floor(range * 0.3), 10),
    ) - Math.floor(
      Math.random() * Math.min(Math.floor(range * 0.3), 10),
    );
    guess = Math.max(room.botMin, Math.min(room.botMax, mid + jitter));
  }

  try {
    const outcome = await processGuess(roomId, BOT_PLAYER_ID, guess);
    bot.attempts += 1;

    // Tell the real player about the bot's guess result
    io.to(room.player1.socketId).emit(SOCKET_EVENTS.GUESS_RESULT, {
      result: outcome.result,
      attemptsLeft: outcome.attemptsLeft,
      opponentAttempts: bot.attempts,
    });

    if (outcome.isCorrect) {
      // Bot guessed correctly → bot wins
      io.to(room.player1.socketId).emit(SOCKET_EVENTS.GAME_OVER, {
        winner: BOT_PLAYER_ID,
        coins: 0,
        eloChange: 0,
        isBotGame: true,
      });
      await markRoomFinished(roomId);
      clearBotGuessTimer(roomId);
      cleanupRoom(roomId);
      return;
    }

    // Narrow the bot's search range
    if (outcome.result === 'higher') {
      room.botMin = guess + 1;
    } else if (outcome.result === 'lower') {
      room.botMax = guess - 1;
    }

    // Check for draw (both exhausted)
    if (
      bot.attempts >= room.maxAttempts &&
      room.player1.attempts >= room.maxAttempts
    ) {
      io.to(room.player1.socketId).emit(SOCKET_EVENTS.GAME_OVER, {
        winner: 'draw',
        coins: 0,
        eloChange: 0,
        isBotGame: true,
      });
      await markRoomFinished(roomId);
      clearBotGuessTimer(roomId);
      cleanupRoom(roomId);
      return;
    }

    // Schedule next guess
    scheduleBotGuess(io, roomId);
  } catch (error) {
    console.error('[LuckyGuess Bot] Guess failed:', error);
    // Retry after a delay
    scheduleBotGuess(io, roomId);
  }
}

/**
 * Mark a room as finished in the DB (fire-and-forget).
 */
async function markRoomFinished(roomId) {
  try {
    await supabaseAdmin
      .from('rooms')
      .update({ status: 'finished' })
      .eq('id', roomId);
  } catch (err) {
    console.error('[LuckyGuess Bot] Failed to mark room finished:', err);
  }
}

// ─────────────────────────────────────────────────────────
// REAL PLAYER MATCH
// ─────────────────────────────────────────────────────────

async function handleMatchFound(io, match) {
  try {
    const { player1, player2 } = match;

    // Clear any pending bot-match timeouts for both players
    clearBotMatchTimeout(player1.userId);
    clearBotMatchTimeout(player2.userId);
    playerQueueInfo.delete(player1.userId);
    playerQueueInfo.delete(player2.userId);

    const room = await createOnlineRoom(
      player1.userId,
      player1.userName,
      player2.userId,
      player2.userName,
    );

    const roomState = {
      roomId: room.id,
      maxAttempts: room.max_attempts,
      isBotGame: false,
      player1: {
        userId: player1.userId,
        socketId: player1.socketId,
        userName: player1.userName,
        attempts: 0,
      },
      player2: {
        userId: player2.userId,
        socketId: player2.socketId,
        userName: player2.userName,
        attempts: 0,
      },
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

    console.log(
      `[LuckyGuess Match] Room ${room.id}: ${player1.userName} vs ${player2.userName}`,
    );
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

// ─────────────────────────────────────────────────────────
// REGISTER ALL SOCKET HANDLERS
// ─────────────────────────────────────────────────────────

/**
 * Register all Socket.IO event handlers on the given io instance
 * (or namespace). JWT auth must already be applied via
 * `io.use(verifySocketToken)` — see src/socket/index.js.
 */
function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    // socket.userId and socket.isGuest are populated by verifySocketToken.
    const userId = socket.userId;
    console.log(
      `[LuckyGuess Socket] Connected: ${socket.id} (user: ${userId}${socket.isGuest ? ' [guest]' : ''})`,
    );

    // Track socket <-> user mapping (replace any stale socket for this user)
    const previousSocketId = userSocketMap.get(userId);
    if (previousSocketId && previousSocketId !== socket.id) {
      // Force-disconnect the stale socket to avoid duplicate sessions.
      io.sockets.sockets.get(previousSocketId)?.disconnect(true);
    }
    socketUserMap.set(socket.id, userId);
    userSocketMap.set(userId, socket.id);

    // ──────────────────────────────────────────────────────
    // JOIN QUEUE
    // ──────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.JOIN_QUEUE, (payload) => {
      // Ignore client-supplied userId — always use the JWT identity.
      const userName =
        (payload && payload.userName) || `Player_${userId.slice(0, 4)}`;
      const elo =
        (payload && typeof payload.elo === 'number') ? payload.elo : 1000;

      if (userRoomMap.has(userId)) {
        socket.emit(SOCKET_EVENTS.ERROR, {
          message: 'You are already in a game',
        });
        return;
      }

      matchmakingQueue.remove(userId);

      const player = { userId, userName, elo, socketId: socket.id };
      matchmakingQueue.add(player);

      // Store player info for the bot-match fallback
      playerQueueInfo.set(userId, player);

      console.log(
        `[LuckyGuess Queue] ${userName} (${userId}) joined. Queue size: ${matchmakingQueue.size}`,
      );

      socket.emit(SOCKET_EVENTS.QUEUE_JOINED, {
        message: `Joined queue. ${matchmakingQueue.size} player(s) waiting.`,
      });

      const match = matchmakingQueue.tryMatch();
      if (match) {
        handleMatchFound(io, match);
      } else {
        // No real opponent yet — start a timer to match with bot
        clearBotMatchTimeout(userId);
        const timeout = setTimeout(() => {
          botMatchTimeouts.delete(userId);
          playerQueueInfo.delete(userId);
          // Only match with bot if the player is STILL in the queue
          if (matchmakingQueue.has(userId)) {
            matchmakingQueue.remove(userId);
            handleBotMatch(io, userId, socket.id, userName);
          }
        }, BOT_MATCH_DELAY);
        botMatchTimeouts.set(userId, timeout);
      }
    });

    // ──────────────────────────────────────────────────────
    // LEAVE QUEUE
    // ──────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.LEAVE_QUEUE, () => {
      const removed = matchmakingQueue.remove(userId);
      if (removed) {
        console.log(
          `[LuckyGuess Queue] ${removed.userName} (${userId}) left queue.`,
        );
      }
      clearBotMatchTimeout(userId);
      playerQueueInfo.delete(userId);
    });

    // ──────────────────────────────────────────────────────
    // SUBMIT GUESS
    // ──────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.SUBMIT_GUESS, async (payload) => {
      const { roomId, guess } = payload || {};
      if (!roomId || typeof guess !== 'number') {
        socket.emit(SOCKET_EVENTS.ERROR, {
          message: 'Invalid guess payload',
        });
        return;
      }

      const room = activeRooms.get(roomId);
      if (!room) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Room not found' });
        return;
      }

      const isPlayer1 = room.player1.userId === userId;
      const isPlayer2 = !room.isBotGame && room.player2.userId === userId;
      if (!isPlayer1 && !isPlayer2) {
        socket.emit(SOCKET_EVENTS.ERROR, {
          message: 'You are not in this room',
        });
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

        // Send guess_result to the guesser (sees opponent's pre-guess count).
        socket.emit(SOCKET_EVENTS.GUESS_RESULT, {
          result: outcome.result,
          attemptsLeft: outcome.attemptsLeft,
          opponentAttempts: opponentAttemptsBefore,
        });

        // If not a bot game, also notify the opponent.
        if (!room.isBotGame && opponentSocketId) {
          io.to(opponentSocketId).emit(SOCKET_EVENTS.GUESS_RESULT, {
            result: outcome.result,
            attemptsLeft: outcome.attemptsLeft,
            opponentAttempts: guesserAttempts,
          });
        }

        // ── Correct guess → game over ──
        if (outcome.isCorrect) {
          const winnerId = userId;
          const loserId = isPlayer1
            ? room.player2.userId
            : room.player1.userId;

          if (room.isBotGame) {
            // ── Bot game: skip endGame (bot has no users row) ──
            await markRoomFinished(roomId);
            try {
              await awardCoins(winnerId, COINS_WIN, 'bot_match_win');
            } catch (coinErr) {
              console.error(
                '[LuckyGuess Bot] Failed to award coins:',
                coinErr,
              );
            }

            socket.emit(SOCKET_EVENTS.GAME_OVER, {
              winner: winnerId,
              coins: COINS_WIN,
              eloChange: 0,
              isBotGame: true,
            });

            clearBotGuessTimer(roomId);
            cleanupRoom(roomId);
            console.log(
              `[LuckyGuess Bot] Room ${roomId} ended. Winner: ${winnerId}`,
            );
          } else {
            // ── Real game: full endGame flow ──
            try {
              const gameResult = await endGame(
                roomId, winnerId, loserId, guesserAttempts,
              );

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
              console.log(
                `[LuckyGuess Game] Room ${roomId} ended. Winner: ${winnerId}`,
              );
            } catch (endError) {
              console.error(
                `[LuckyGuess Game] endGame failed for room ${roomId}:`,
                endError,
              );
              socket.emit(SOCKET_EVENTS.ERROR, {
                message: 'Failed to finalize game',
              });
              if (opponentSocketId) {
                io.to(opponentSocketId).emit(SOCKET_EVENTS.ERROR, {
                  message: 'Failed to finalize game',
                });
              }
            }
          }
          return;
        }

        // ── Draw: both players exhausted their attempts ──
        if (
          outcome.attemptsLeft === 0 &&
          room.player1.attempts >= room.maxAttempts &&
          (room.isBotGame ||
            room.player2.attempts >= room.maxAttempts)
        ) {
          await markRoomFinished(roomId);

          const gameOverPayload = {
            winner: 'draw',
            coins: 0,
            eloChange: 0,
            isBotGame: room.isBotGame,
            matchId: '',
          };

          socket.emit(SOCKET_EVENTS.GAME_OVER, gameOverPayload);
          if (!room.isBotGame && opponentSocketId) {
            io.to(opponentSocketId).emit(SOCKET_EVENTS.GAME_OVER, gameOverPayload);
          }

          if (room.isBotGame) clearBotGuessTimer(roomId);
          cleanupRoom(roomId);
          console.log(
            `[LuckyGuess Game] Room ${roomId} ended in a draw.`,
          );
        }
      } catch (guessError) {
        const message =
          guessError instanceof Error
            ? guessError.message
            : 'Guess failed';
        socket.emit(SOCKET_EVENTS.ERROR, { message });
      }
    });

    // ──────────────────────────────────────────────────────
    // FORFEIT
    // ──────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.FORFEIT, async (payload) => {
      const { roomId } = payload || {};
      const room = activeRooms.get(roomId);
      if (!room) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Room not found' });
        return;
      }

      const opponentSocketId =
        room.player1.userId === userId
          ? room.player2.socketId
          : room.player1.socketId;

      if (room.isBotGame) {
        // Forfeiting a bot game — just clean up
        await markRoomFinished(roomId);
        clearBotGuessTimer(roomId);
        socket.emit(SOCKET_EVENTS.GAME_OVER, {
          winner: BOT_PLAYER_ID,
          coins: 0,
          eloChange: 0,
          isBotGame: true,
        });
        cleanupRoom(roomId);
        console.log(
          `[LuckyGuess Bot] Player ${userId} forfeited bot room ${roomId}`,
        );
        return;
      }

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
        console.log(
          `[LuckyGuess Game] Player ${userId} forfeited room ${roomId}`,
        );
      } catch (forfeitError) {
        const message =
          forfeitError instanceof Error
            ? forfeitError.message
            : 'Forfeit failed';
        socket.emit(SOCKET_EVENTS.ERROR, { message });
      }
    });

    // ──────────────────────────────────────────────────────
    // DISCONNECT
    // ──────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      socketUserMap.delete(socket.id);
      // Only clear userSocketMap if it still points to THIS socket.
      if (userSocketMap.get(userId) === socket.id) {
        userSocketMap.delete(userId);
      }
      matchmakingQueue.remove(userId);
      clearBotMatchTimeout(userId);
      playerQueueInfo.delete(userId);

      const roomId = userRoomMap.get(userId);
      if (roomId) {
        const room = activeRooms.get(roomId);
        if (room) {
          // ── Bot game: just clean up, no need to award bot ──
          if (room.isBotGame) {
            await markRoomFinished(roomId);
            clearBotGuessTimer(roomId);
            cleanupRoom(roomId);
            console.log(
              `[LuckyGuess Bot] ${userId} disconnected from bot room ${roomId}`,
            );
            return;
          }

          // ── Real game: award win to the opponent ──
          const opponentUserId =
            room.player1.userId === userId
              ? room.player2.userId
              : room.player1.userId;
          const opponentSocketId =
            room.player1.userId === userId
              ? room.player2.socketId
              : room.player1.socketId;

          // Mark the room abandoned in the DB (fire-and-forget).
          try {
            await supabaseAdmin
              .from('rooms')
              .update({ status: 'abandoned' })
              .eq('id', roomId);
          } catch (err) {
            console.error(
              '[LuckyGuess] Failed to mark room abandoned:',
              err,
            );
          }

          // Award the win to the opponent.
          try {
            const gameResult = await forfeitGame(roomId, userId);

            if (opponentSocketId) {
              io.to(opponentSocketId).emit(
                SOCKET_EVENTS.OPPONENT_DISCONNECTED,
                {
                  message: 'Your opponent disconnected. You win!',
                  coins: gameResult.coinsAwarded,
                },
              );
              io.to(opponentSocketId).emit(SOCKET_EVENTS.GAME_OVER, {
                winner: gameResult.winnerId,
                coins: gameResult.coinsAwarded,
                eloChange: gameResult.winnerEloChange,
                matchId: gameResult.matchId,
              });
            }
          } catch (err) {
            console.error(
              `[LuckyGuess] Failed to award win on disconnect for room ${roomId}:`,
              err,
            );
            if (opponentSocketId) {
              io.to(opponentSocketId).emit(
                SOCKET_EVENTS.OPPONENT_DISCONNECTED,
                {
                  message: 'Your opponent disconnected.',
                  coins: COINS_WIN,
                },
              );
            }
          }

          cleanupRoom(roomId);
          console.log(
            `[LuckyGuess Socket] ${userId} disconnected (${reason}). Room ${roomId} awarded to opponent ${opponentUserId}.`,
          );
        }
      }

      console.log(
        `[LuckyGuess Socket] Disconnected: ${socket.id} (user: ${userId}) — ${reason}`,
      );
    });
  });
}

module.exports = { registerSocketHandlers };