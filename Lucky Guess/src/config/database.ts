// ============================================================
// Lucky Guess — Database (Supabase) Configuration
// Contoura Labs
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Admin client — uses the service role key, bypasses RLS.
 * Use for server-side operations that need full access.
 */
export const supabaseAdmin: SupabaseClient = createClient(
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
 * Use for user-scoped operations.
 */
export const supabaseAnon: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);