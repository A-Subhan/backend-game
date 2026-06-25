// ============================================================
// Lucky Guess — Socket.IO Initialization
// Contoura Labs
//
// Registers the JWT auth middleware on the io instance (or
// namespace), then attaches the Lucky Guess event handlers.
//
// The frontend's `socketService.ts` connects to the default
// namespace with `auth: { token }`. The token is the same JWT
// issued by `POST /guest` or `POST /auth/google/callback`.
// ============================================================

const { registerSocketHandlers } = require('./handlers');
const { verifySocketToken } = require('../middleware/auth');

/**
 * Initialize Socket.IO with JWT auth + Lucky Guess handlers.
 *
 * @param {import('socket.io').Server|import('socket.io').Namespace} io
 */
function initializeSocket(io) {
  // Auth middleware — rejects connections without a valid JWT.
  io.use(verifySocketToken);

  registerSocketHandlers(io);
  console.log('[LuckyGuess Socket] Handlers + JWT auth initialized');
}

module.exports = { initializeSocket };
