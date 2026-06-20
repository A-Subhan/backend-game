require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// ── Existing Game (WordScramble / Number Guessing) ──
const authRoutes = require('./server/routes/auth');
const profileRoutes = require('./server/routes/profile');
const leaderboardRoutes = require('./server/routes/leaderboard');
const matchRoutes = require('./server/routes/match');
const { initMatchmaking } = require('./server/socket/matchmaking');
const { initGameHandler } = require('./server/socket/gameHandler');
const { initGiftHandler } = require('./server/socket/giftHandler');
const { initWebRTCSignaling } = require('./server/socket/webrtcSignaling');
const { verifySocketToken } = require('./server/middleware/auth');

// ── Lucky Guess by Contoura Labs ──
const luckyGuess = require('./Lucky Guess');

const app = express();
const server = http.createServer(app);

// ── CORS ──
app.use(cors({
  origin: '*', // In production, replace with your app's domain
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json());

// ── EXISTING GAME REST ROUTES ──
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/match', matchRoutes);

// ── LUCKY GUESS REST ROUTES ──
luckyGuess.mountRoutes(app, '/api/lucky-guess');

// Health check — Render / Railway uses this to know the server is alive
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── SOCKET.IO ──
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Authenticate every socket connection on the default namespace using JWT
io.use(verifySocketToken);

io.on('connection', (socket) => {
  console.log(`✅ Player connected: ${socket.userId} (${socket.id})`);

  // Wire up all feature handlers for existing game
  initMatchmaking(io, socket);
  initGameHandler(io, socket);
  initGiftHandler(io, socket);
  initWebRTCSignaling(io, socket);

  socket.on('disconnect', (reason) => {
    console.log(`❌ Player disconnected: ${socket.userId} — ${reason}`);
  });
});

// ── LUCKY GUESS SOCKET NAMESPACE ──
// Runs on its own namespace '/lucky-guess' — isolated from the default namespace
luckyGuess.mountSocket(io, '/lucky-guess');

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Game Server running on port ${PORT}`);
  console.log(`   Default namespace: / (existing game)`);
  console.log(`   Lucky Guess namespace: /lucky-guess`);
});