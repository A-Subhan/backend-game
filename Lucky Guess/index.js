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
    // Load .env from Lucky Guess folder (if not already loaded)
    try {
      const dotenv = require('dotenv');
      const envPath = path.resolve(__dirname, '.env');
      dotenv.config({ path: envPath });
    } catch (e) {
      // dotenv not available
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
 * Mount all Lucky Guess REST routes under a prefix on the Express app.
 */
function mountRoutes(app, prefix = '/api/lucky-guess') {
  if (!loadModules()) return;

  app.use(`${prefix}/auth`, _authRoutes);
  app.use(`${prefix}/user`, _userRoutes);
  app.use(`${prefix}/leaderboard`, _leaderboardRoutes);

  console.log(`[LuckyGuess] Routes mounted under ${prefix}`);
}

/**
 * Initialize Lucky Guess Socket.IO on a namespace.
 */
function mountSocket(io, namespace = '/lucky-guess') {
  if (!loadModules()) return;

  const nsp = io.of(namespace);
  _initializeSocket(nsp);
  console.log(`[LuckyGuess] Socket namespace: ${namespace}`);
}

module.exports = { mountRoutes, mountSocket };