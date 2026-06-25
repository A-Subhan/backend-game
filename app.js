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

// ── Diagnostic: load each module in its own try/catch and
// record the EXACT error. This makes it trivial to debug
// "no routes mounted" issues on Railway / Render / etc.
// ============================================================
const moduleStatus = {};   // { path: { ok: bool, error: string|null, stack: string|null } }

function tryRequire(label, path) {
  try {
    const mod = require(path);
    moduleStatus[label] = { ok: true, error: null, stack: null };
    console.log(`[Startup] OK  ${label}`);
    return mod;
  } catch (err) {
    moduleStatus[label] = {
      ok: false,
      error: err.message,
      stack: err.stack,
      code: err.code,
    };
    console.error(`[Startup] FAIL ${label}: ${err.message}`);
    console.error(err.stack);
    return null;
  }
}

// Load foundational modules first (so we can see if THE ISSUE
// is in env/database/middleware vs. in routes/controllers).
const envModule     = tryRequire('config/env',           './src/config/env');
const dbModule      = tryRequire('config/database',      './src/config/database');
const authMiddleware = tryRequire('middleware/auth',     './src/middleware/auth');
const sharedConsts  = tryRequire('shared/constants',     './shared/constants');

// Controllers (depend on database + env + shared)
const authController        = tryRequire('controllers/authController',        './src/controllers/authController');
const userController        = tryRequire('controllers/userController',        './src/controllers/userController');
const leaderboardController = tryRequire('controllers/leaderboardController', './src/controllers/leaderboardController');

// Services (depend on database + shared)
const matchmakingService = tryRequire('services/matchmaking',     './src/services/matchmaking');
const gameService         = tryRequire('services/gameService',     './src/services/gameService');
const eloService          = tryRequire('services/eloService',      './src/services/eloService');
const coinService         = tryRequire('services/coinService',     './src/services/coinService');
const achievementService  = tryRequire('services/achievementService', './src/services/achievementService');

// Routes (depend on controllers + middleware)
const authRoutes        = tryRequire('routes/authRoutes',        './src/routes/authRoutes');
const userRoutes        = tryRequire('routes/userRoutes',        './src/routes/userRoutes');
const leaderboardRoutes = tryRequire('routes/leaderboardRoutes', './src/routes/leaderboardRoutes');

// Socket (depends on services + middleware + database)
const socketModule      = tryRequire('socket/index',             './src/socket');

// ── Express app ─────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request logging ─────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method} ${req.url}`);
  next();
});

// ── Mount REST routes at root ───────────────────────────
const registeredGroups = [];

if (authRoutes) {
  app.use('/', authRoutes);
  registeredGroups.push('auth: POST /guest, POST /auth/google/callback, GET /auth/me, POST /auth/logout');
  console.log('[Startup] Mounted auth routes at /');
}
if (userRoutes) {
  app.use('/', userRoutes);
  registeredGroups.push('user: GET /user/profile, GET /user/stats, GET /user/history, GET /user/achievements');
  console.log('[Startup] Mounted user routes at /');
}
if (leaderboardRoutes) {
  app.use('/', leaderboardRoutes);
  registeredGroups.push('leaderboard: GET /leaderboard');
  console.log('[Startup] Mounted leaderboard routes at /');
}

// ── Health check ────────────────────────────────────────
app.get('/health', (_req, res) => {
  // Force Supabase init so we can report its real status.
  const dbReady = dbModule ? dbModule.isSupabaseReady() : false;
  const dbError = dbModule ? dbModule.getSupabaseInitError() : null;
  const envObj = envModule ? envModule.env : null;

  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    service: 'lucky-guess-backend',
    version: '2.2.0',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    env: {
      NODE_ENV: process.env.NODE_ENV || '(unset)',
      PORT: process.env.PORT || '(unset, using default 3001)',
      SUPABASE_URL_set: !!(envObj && envObj.SUPABASE_URL),
      SUPABASE_ANON_KEY_set: !!(envObj && envObj.SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY_set: !!(envObj && envObj.SUPABASE_SERVICE_ROLE_KEY),
      JWT_SECRET_set: !!(envObj && envObj.JWT_SECRET && envObj.JWT_SECRET !== 'dev-only-insecure-secret-change-me'),
      GOOGLE_CLIENT_ID_set: !!(envObj && envObj.GOOGLE_CLIENT_ID),
      supabaseReady: dbReady,
      supabaseError: dbError ? dbError.message : null,
    },
    routesLoaded: {
      auth: !!authRoutes,
      user: !!userRoutes,
      leaderboard: !!leaderboardRoutes,
      socket: !!socketModule,
    },
    groupsMounted: registeredGroups.length,
  });
});

// ── Debug: list all registered HTTP routes ──────────────
app.get('/debug/routes', (_req, res) => {
  const routes = [];
  function walk(stack, basePath = '') {
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
        routes.push({ path: basePath + layer.route.path, methods });
      } else if (layer.name === 'router' && layer.handle.stack) {
        walk(layer.handle.stack, basePath);
      }
    }
  }
  if (app._router) walk(app._router.stack);
  res.json({
    total: routes.length,
    routes,
    registeredGroups,
    modulesLoaded: {
      authRoutes: !!authRoutes,
      userRoutes: !!userRoutes,
      leaderboardRoutes: !!leaderboardRoutes,
      socket: !!socketModule,
    },
  });
});

// ── Debug: list every module load status with errors ───
// This is THE endpoint to hit when routes aren't mounting.
// It shows exactly which file failed to load and the error.
app.get('/debug/modules', (_req, res) => {
  const summary = Object.entries(moduleStatus).map(([label, info]) => ({
    module: label,
    ok: info.ok,
    error: info.error,
    code: info.code || null,
    stack: info.stack ? info.stack.split('\n').slice(0, 10).join('\n') : null,
  }));

  const failedCount = summary.filter(s => !s.ok).length;
  res.json({
    total: summary.length,
    ok: summary.length - failedCount,
    failed: failedCount,
    modules: summary,
  });
});

// ── Root info ───────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: 'Lucky Guess Backend',
    by: 'Contoura Labs',
    version: '2.2.0',
    endpoints: {
      auth: ['/auth/google/callback', '/guest', '/auth/me', '/auth/logout'],
      user: ['/user/profile', '/user/stats', '/user/history', '/user/achievements'],
      leaderboard: ['/leaderboard'],
      health: ['/health'],
      debug: ['/debug/routes', '/debug/modules'],
    },
    socket: { namespace: '/', events: ['join_queue', 'leave_queue', 'submit_guess', 'forfeit'] },
    diagnostics: 'If routes are missing, visit /debug/modules to see which files failed to load.',
  });
});

// ── 404 ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.url}`,
    hint: 'Visit /debug/routes to see all registered routes, /debug/modules to see module load errors, or /health for server status.',
  });
});

// ── Global error handler ────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Unhandled Error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ── Socket.IO ───────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

if (socketModule && typeof socketModule.initializeSocket === 'function') {
  try {
    socketModule.initializeSocket(io);
    console.log('[Startup] Socket.IO handlers registered on default namespace');
  } catch (err) {
    console.error('[Startup] FAILED to initialize socket handlers:', err.message);
    console.error(err.stack);
  }
} else {
  console.warn('[Startup] Socket.IO not initialized — module failed to load');
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  const failedModules = Object.entries(moduleStatus).filter(([, info]) => !info.ok).map(([label]) => label);
  console.log('===============================================');
  console.log(`  Lucky Guess Backend running on port ${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Node: ${process.version}  Platform: ${process.platform}/${process.arch}`);
  console.log(`  Health:  http://localhost:${PORT}/health`);
  console.log(`  Routes:  http://localhost:${PORT}/debug/routes`);
  console.log(`  Modules: http://localhost:${PORT}/debug/modules`);
  console.log(`  Route groups mounted: ${registeredGroups.length}`);
  registeredGroups.forEach(r => console.log(`    - ${r}`));
  if (failedModules.length > 0) {
    console.log(`  WARNING: ${failedModules.length} module(s) failed to load:`);
    failedModules.forEach(m => console.log(`    - ${m}`));
    console.log(`  Visit /debug/modules for details.`);
  }
  console.log('===============================================');
});

module.exports = { app, server, io };
