// ============================================================
// Lucky Guess — Project Init Module
// Contoura Labs
//
// Lazy-loads all modules so missing env vars (SUPABASE_URL etc.)
// do NOT crash the root server. Only logs a warning.
// ============================================================

const path = require('path');

let _loaded = false;
let _authRoutes, _userRoutes, _leaderboardRoutes, _initializeSocket;

function loadModules() {
  if (_loaded) return true;

  try {
    // Load .env from Lucky Guess folder (if not already loaded by root)
    try {
      const dotenv = require('dotenv');
      const envPath = path.resolve(__dirname, '.env');
      dotenv.config({ path: envPath });
    } catch (_e) {
      // dotenv not available — root app.js already loaded it
    }

    _authRoutes = require('./src/routes/authRoutes');
    _userRoutes = require('./src/routes/userRoutes');
    _leaderboardRoutes = require('./src/routes/leaderboardRoutes');
    const socket = require('./src/socket');
    _initializeSocket = socket.initializeSocket;

    _loaded = true;
    return true;
  } catch (err) {
    console.warn('[LuckyGuess] Could not load modules — is Supabase configured?');
    console.warn(`[LuckyGuess] Error: ${err.message}`);
    console.warn('[LuckyGuess] Routes and socket will be skipped. Set SUPABASE_URL in env to enable.');
    return false;
  }
}

/**
 * Mount all Lucky Guess REST routes at root paths so they match
 * the frontend's `shared/constants.ts` API map:
 *
 *   POST   /guest
 *   POST   /auth/google/callback
 *   GET    /auth/me
 *   POST   /auth/logout
 *   GET    /user/profile
 *   GET    /user/stats
 *   GET    /user/history
 *   GET    /user/achievements
 *   GET    /leaderboard
 */
function mountRoutes(app) {
  // Always mount — even if Supabase is not configured, the routes
  // will return a clear 503 error so the frontend gets useful feedback.
  loadModules();

  if (_authRoutes) {
    app.use('/', _authRoutes);
  }
  if (_userRoutes) {
    app.use('/', _userRoutes);
  }
  if (_leaderboardRoutes) {
    app.use('/', _leaderboardRoutes);
  }

  console.log('[LuckyGuess] REST routes mounted at root paths');
}

/**
 * Initialize Lucky Guess Socket.IO handlers on the given io instance
 * (default namespace). The frontend's `socketService.ts` connects
 * to the default namespace with `auth: { token }`.
 */
function mountSocket(io) {
  loadModules();

  if (!_initializeSocket) {
    console.warn('[LuckyGuess] Socket handlers not loaded — Supabase/JWT not configured');
    return;
  }

  _initializeSocket(io);
  console.log('[LuckyGuess] Socket.IO handlers registered on default namespace');
}

module.exports = { mountRoutes, mountSocket };
