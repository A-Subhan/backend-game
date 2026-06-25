// ============================================================
// Lucky Guess — Database (Supabase) Configuration
// Contoura Labs
//
// LAZY initialization: the Supabase clients are created on first
// access, not at module-load time. This way:
//   1. A missing/bad @supabase/supabase-js install doesn't break
//      the whole server — only Supabase-dependent routes fail.
//   2. Late-arriving env vars (e.g. set after process start) work.
//   3. The module always exports usable functions.
// ============================================================

const { env } = require('./env');

let _supabaseAdmin = null;
let _supabaseAnon = null;
let _initError = null;
let _initAttempted = false;

function initClients() {
  if (_initAttempted) return;
  _initAttempted = true;

  if (!env.isSupabaseConfigured()) {
    console.warn('[LuckyGuess] Supabase clients NOT initialized — missing env vars');
    return;
  }

  try {
    // Lazy-require so a broken install only fails this call,
    // not the whole module-load chain.
    const { createClient } = require('@supabase/supabase-js');

    _supabaseAdmin = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    _supabaseAnon = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    console.log('[LuckyGuess] Supabase clients initialized');
  } catch (err) {
    _initError = err;
    console.error('[LuckyGuess] FAILED to initialize Supabase clients:', err.message);
    console.error(err.stack);
  }
}

// Use getters so the clients are created on first access,
// after env vars are guaranteed to be loaded.
Object.defineProperty(module.exports, 'supabaseAdmin', {
  get() { initClients(); return _supabaseAdmin; },
  enumerable: true,
  configurable: true,
});

Object.defineProperty(module.exports, 'supabaseAnon', {
  get() { initClients(); return _supabaseAnon; },
  enumerable: true,
  configurable: true,
});

module.exports.supabaseUnavailable = function supabaseUnavailable(res) {
  initClients();
  if (!_supabaseAdmin) {
    const detail = _initError
      ? `Database initialization failed: ${_initError.message}`
      : 'Database not configured on the server. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY env vars.';
    res.status(503).json({ error: detail });
    return true;
  }
  return false;
};

module.exports.getSupabaseInitError = function getSupabaseInitError() {
  initClients();
  return _initError;
};

module.exports.isSupabaseReady = function isSupabaseReady() {
  initClients();
  return !!_supabaseAdmin;
};
