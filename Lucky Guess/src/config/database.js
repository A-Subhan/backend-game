// ============================================================
// Lucky Guess — Database (Supabase) Configuration
// Contoura Labs
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const { env } = require('./env');

/**
 * Admin client — uses the service role key, bypasses RLS.
 */
const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Anon client — uses the anon key, respects RLS.
 */
const supabaseAnon = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

module.exports = { supabaseAdmin, supabaseAnon };