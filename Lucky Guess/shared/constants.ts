// ============================================================
// Lucky Guess — Shared Constants
// Contoura Labs
// ============================================================

import { AchievementKey, GameConfig, GameMode } from './types';

/* ── Game Difficulty Configs ──────────────────────────── */
export const GAME_CONFIGS: Record<GameMode, GameConfig> = {
  single_easy:     { min: 1,  max: 50,   maxAttempts: 15 },
  single_medium:   { min: 1,  max: 100,  maxAttempts: 10 },
  single_hard:     { min: 1,  max: 500,  maxAttempts: 8  },
  single_custom:   { min: 1,  max: 100,  maxAttempts: 10 },
  local:           { min: 1,  max: 100,  maxAttempts: 10 },
  online:          { min: 1,  max: 100,  maxAttempts: 10 },
};

/* ── Coin Rewards ─────────────────────────────────────── */
export const COINS_WIN  = 50;
export const COINS_LOSS = 10;

/* ── ELO Settings ─────────────────────────────────────── */
export const ELO_INITIAL      = 1000;
export const ELO_K_FACTOR     = 32;
export const ELO_DEFAULT_CHANGE_WIN  =  25;
export const ELO_DEFAULT_CHANGE_LOSS = -20;

/* ── Achievements Definition ──────────────────────────── */
export interface AchievementDef {
  key: AchievementKey;
  title: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'first_win',    title: 'First Win',       description: 'Win your first match',                icon: '🏆' },
  { key: 'lucky_guess',  title: 'Lucky Guess',     description: 'Win in exactly 1 attempt',            icon: '🍀' },
  { key: 'sharpshooter', title: 'Sharpshooter',    description: 'Win in 3 or fewer attempts',          icon: '🎯' },
  { key: 'veteran',      title: 'Veteran',         description: 'Play 10 matches',                     icon: '🎖️' },
  { key: 'streak_3',     title: 'Streak x3',       description: 'Win 3 matches in a row',              icon: '🔥' },
  { key: 'collector_500',title: 'Collector',       description: 'Earn 500 total coins',                icon: '💰' },
];

/* ── Socket Events ─────────────────────────────────────── */
export const SOCKET_EVENTS = {
  // Client → Server
  JOIN_QUEUE:    'join_queue',
  LEAVE_QUEUE:   'leave_queue',
  SUBMIT_GUESS:  'submit_guess',
  FORFEIT:       'forfeit',

  // Server → Client
  QUEUE_JOINED:           'queue_joined',
  MATCH_FOUND:            'match_found',
  GUESS_RESULT:           'guess_result',
  GAME_OVER:              'game_over',
  OPPONENT_DISCONNECTED:  'opponent_disconnected',
  ERROR:                  'error',
} as const;

/* ── Theme ────────────────────────────────────────────── */
export const THEME_KEYS = {
  LIGHT: 'light',
  DARK:  'dark',
} as const;

/* ── Async Storage Keys ──────────────────────────────── */
export const STORAGE_KEYS = {
  THEME:        '@lucky_guess/theme',
  USER:         '@lucky_guess/user',
  AUTH_TOKEN:   '@lucky_guess/auth_token',
  SOUND:        '@lucky_guess/sound_enabled',
  VIBRATION:    '@lucky_guess/vibration_enabled',
  GUEST_MODE:   '@lucky_guess/guest_mode',
} as const;

/* ── API Endpoints ────────────────────────────────────── */
export const API = {
  BASE_URL: '',
  AUTH: {
    GOOGLE_CALLBACK:  '/auth/google/callback',
    GUEST_LOGIN:      '/auth/guest',
    ME:               '/auth/me',
    LOGOUT:           '/auth/logout',
  },
  USER: {
    PROFILE:    '/user/profile',
    STATS:      '/user/stats',
    HISTORY:    '/user/history',
    LEADERBOARD:'/leaderboard',
    ACHIEVEMENTS:'/user/achievements',
  },
} as const;