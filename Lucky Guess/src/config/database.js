// ============================================================
// Lucky Guess — Database (Supabase) Configuration
// Contoura Labs
//
// Returns null clients if Supabase is not configured. Callers
// must check `env.isSupabaseConfigured()` before using.
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { env } = require('./env');

let supabaseAdmin = null;
let supabaseAnon = null;

if (env.isSupabaseConfigured()) {
  // Admin client — uses the service role key, bypasses RLS.
  // Use only on the server, never expose to the client.
  supabaseAdmin = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );

  // Anon client — uses the anon key, respects RLS.
  supabaseAnon = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );

  console.log('[LuckyGuess] Supabase clients initialized');
} else {
  console.warn('[LuckyGuess] Supabase clients NOT initialized — missing env vars');
}

/**
 * Guard helper for controllers. Returns true if Supabase is
 * unavailable; in that case the controller should respond 503.
 */
function supabaseUnavailable(res) {
  if (!supabaseAdmin) {
    res.status(503).json({
      error: 'Database not configured on the server. Contact the administrator.',
    });
    return true;
  }
  return false;
}

module.exports = { supabaseAdmin, supabaseAnon, supabaseUnavailable };
