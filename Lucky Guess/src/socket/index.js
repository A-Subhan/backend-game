// ============================================================
// Lucky Guess — Socket.IO Initialization
// Contoura Labs
// ============================================================

const { registerSocketHandlers } = require('./handlers');

/**
 * Initialize Socket.IO namespace with all Lucky Guess event handlers.
 * Pass io.of('/lucky-guess') to isolate from other games.
 */
function initializeSocket(io) {
  registerSocketHandlers(io);
  console.log('[LuckyGuess Socket] Handlers initialized');
}

module.exports = { initializeSocket };