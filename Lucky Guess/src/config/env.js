// ============================================================
// Lucky Guess — Environment Configuration
// Contoura Labs
//
// Lenient loader: missing variables return '' instead of
// throwing. Controllers check `env.isSupabaseConfigured()`
// at runtime and return a 503 if Supabase is unavailable.
// ============================================================

const path = require('path');

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
} catch (_e) {
  // dotenv not available — root app.js already loaded it
}

function getEnvVar(name) {
  const value = process.env[name];
  return value || '';
}

function getEnvNumber(name, defaultValue) {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

const env = {
  PORT: getEnvNumber('PORT', 3001),
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Supabase
  SUPABASE_URL: getEnvVar('SUPABASE_URL'),
  SUPABASE_ANON_KEY: getEnvVar('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY:
    getEnvVar('SUPABASE_SERVICE_ROLE_KEY') ||
    getEnvVar('SUPABASE_SERVICE_KEY'), // backwards compat

  // Google OAuth
  GOOGLE_CLIENT_ID: getEnvVar('GOOGLE_CLIENT_ID'),

  // JWT
  JWT_SECRET: getEnvVar('JWT_SECRET') || 'dev-only-insecure-secret-change-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  // Frontend URL (for CORS / email links — currently informational)
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  isDev() {
    return this.NODE_ENV === 'development';
  },

  /**
   * True only if all three Supabase credentials are present.
   * Routes that need Supabase should check this and return 503
   * rather than crashing.
   */
  isSupabaseConfigured() {
    return (
      this.SUPABASE_URL.length > 0 &&
      this.SUPABASE_ANON_KEY.length > 0 &&
      this.SUPABASE_SERVICE_ROLE_KEY.length > 0
    );
  },
};

if (!env.isSupabaseConfigured()) {
  console.warn('[LuckyGuess] Supabase not fully configured — Supabase-dependent routes will return 503.');
  console.warn('[LuckyGuess] Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env');
}

if (env.JWT_SECRET === 'dev-only-insecure-secret-change-me') {
  console.warn('[LuckyGuess] JWT_SECRET not set — using insecure dev default. Do NOT use in production.');
}

module.exports = { env };
