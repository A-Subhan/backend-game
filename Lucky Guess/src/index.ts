// ============================================================
// Lucky Guess — Server Entry Point
// Contoura Labs
// ============================================================

import 'tsconfig-paths/register';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import './config/env'; // Load env vars first

import { env } from './config/env';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import leaderboardRoutes from './routes/leaderboardRoutes';
import { initializeSocket } from './socket';

const app = express();
const httpServer = createServer(app);

// ── Socket.IO ──────────────────────────────────────────────
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.isDev()
      ? '*' // Allow all origins in development
      : env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// ── Express Middleware ─────────────────────────────────────
app.use(cors({
  origin: env.isDev()
    ? '*'
    : env.FRONTEND_URL,
  credentials: true,
}));
app.use(express.json());

// ── Health Check ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      service: 'lucky-guess-backend',
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
  });
});

// ── API Routes ────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/leaderboard', leaderboardRoutes);

// ── 404 Handler ───────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// ── Global Error Handler ──────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: env.isDev() ? err.message : 'Internal server error',
  });
});

// ── Initialize Socket.IO ─────────────────────────────────
initializeSocket(io);

// ── Start Server ──────────────────────────────────────────
httpServer.listen(env.PORT, () => {
  console.log(`Lucky Guess server running on port ${env.PORT}`);
});

export { app, httpServer, io };