// ============================================================
// Lucky Guess — Project Init Module
// Contoura Labs
//
// This file is the entry point for the Lucky Guess backend.
// It exports routes and a socket initializer so the root app.js
// can mount them alongside other game projects.
//
// Usage in root app.js:
//   const luckyGuess = require('./Lucky Guess');
//   luckyGuess.mountRoutes(app);
//   luckyGuess.mountSocket(io);
// ============================================================

const path = require('path');

// Load .env from Lucky Guess folder (if not already loaded)
try {
  const dotenv = require('dotenv');
  const envPath = path.resolve(__dirname, '.env');
  dotenv.config({ path: envPath });
} catch (e) {
  // dotenv not available or .env not found — rely on system env vars
}

const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const leaderboardRoutes = require('./src/routes/leaderboardRoutes');
const { initializeSocket } = require('./src/socket');

/**
 * Mount all Lucky Guess REST routes under a prefix on the Express app.
 * @param {import('express').Express} app
 * @param {string} [prefix='/api/lucky-guess'] - Route prefix
 */
function mountRoutes(app, prefix = '/api/lucky-guess') {
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/user`, userRoutes);
  app.use(`${prefix}/leaderboard`, leaderboardRoutes);

  console.log(`[LuckyGuess] Routes mounted under ${prefix}`);
}

/**
 * Initialize Lucky Guess Socket.IO on a namespace.
 * @param {import('socket.io').Server} io - Root Socket.IO server
 * @param {string} [namespace='/lucky-guess'] - Socket namespace
 */
function mountSocket(io, namespace = '/lucky-guess') {
  const nsp = io.of(namespace);
  initializeSocket(nsp);
  console.log(`[LuckyGuess] Socket namespace: ${namespace}`);
}

module.exports = { mountRoutes, mountSocket };