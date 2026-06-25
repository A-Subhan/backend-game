// ============================================================
// Lucky Guess — Backend Entry Point
// Contoura Labs
//
// Single Express + Socket.IO server for the Lucky Guess
// React Native app. All REST routes are mounted at root so
// the paths match the frontend's `shared/constants.ts` API map.
// ============================================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const luckyGuess = require('./Lucky Guess');

const app = express();
const server = http.createServer(app);

// ── CORS ────────────────────────────────────────────────
// Allow any origin — the auth model is Bearer-token based,
// not cookie based, so wildcard CORS is safe here.
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request logging (lightweight) ───────────────────────
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method} ${req.url}`);
  next();
});

// ── REST Routes ─────────────────────────────────────────
// Mounted at root — frontend calls /guest, /auth/me,
// /user/profile, /leaderboard, etc. directly.
luckyGuess.mountRoutes(app);

// ── Health check ────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    service: 'lucky-guess-backend',
    version: '2.0.0',
  });
});

// ── Root info ───────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: 'Lucky Guess Backend',
    by: 'Contoura Labs',
    version: '2.0.0',
    endpoints: {
      auth: ['/auth/google/callback', '/guest', '/auth/me', '/auth/logout'],
      user: ['/user/profile', '/user/stats', '/user/history', '/user/achievements'],
      leaderboard: ['/leaderboard'],
      health: ['/health'],
    },
    socket: {
      namespace: '/',
      events: ['join_queue', 'leave_queue', 'submit_guess', 'forfeit'],
    },
  });
});

// ── 404 ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.url}` });
});

// ── Global error handler ────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Unhandled Error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

// ── Socket.IO (default namespace, JWT auth) ─────────────
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Wire up Lucky Guess socket handlers on the default namespace.
// The frontend's `socketService.ts` connects to the default
// namespace with `auth: { token }`.
luckyGuess.mountSocket(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('===============================================');
  console.log(`  Lucky Guess Backend running on port ${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log('===============================================');
});

module.exports = { app, server, io };
