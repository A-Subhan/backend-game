// ============================================================
// Lucky Guess — Shared Types
// Contoura Labs
// ============================================================

/* ── User ─────────────────────────────────────────────── */
export interface User {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  coins: number;
  elo: number;
  total_wins: number;
  total_losses: number;
  total_matches: number;
  streak: number;
  best_streak: number;
  created_at: string;
  updated_at: string;
}

export interface UserProfile extends User {
  achievements: Achievement[];
  match_history: MatchRecord[];
}

/* ── Match ────────────────────────────────────────────── */
export type GameMode = 'single_easy' | 'single_medium' | 'single_hard' | 'single_custom' | 'local' | 'online';
export type RoomStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';

export interface MatchRecord {
  id: string;
  player1_id: string;
  player2_id: string | null;
  winner_id: string | null;
  mode: GameMode;
  secret_number: number | null;
  player1_attempts: number;
  player2_attempts: number | null;
  created_at: string;
  duration_seconds: number;
}

/* ── Room (Online Multiplayer) ────────────────────────── */
export interface Room {
  id: string;
  player1_id: string;
  player1_name: string;
  player2_id: string | null;
  player2_name: string | null;
  secret_number: number;
  min_number: number;
  max_number: number;
  status: RoomStatus;
  created_at: string;
  max_attempts: number;
}

/* ── Socket Events ────────────────────────────────────── */
export interface ClientToServerEvents {
  'join_queue': (payload: { userId: string; userName: string; elo: number }) => void;
  'leave_queue': (payload: { userId: string }) => void;
  'submit_guess': (payload: { roomId: string; guess: number }) => void;
  'forfeit': (payload: { roomId: string }) => void;
  'disconnect': () => void;
}

export interface ServerToClientEvents {
  'queue_joined': (payload: { message: string }) => void;
  'match_found': (payload: { room: Room; opponentName: string }) => void;
  'guess_result': (payload: { result: 'higher' | 'lower' | 'correct'; attemptsLeft: number; opponentAttempts?: number }) => void;
  'game_over': (payload: { winner: string; coins: number; eloChange: number; matchId: string }) => void;
  'opponent_disconnected': (payload: { message: string; coins: number }) => void;
  'error': (payload: { message: string }) => void;
}

/* ── Achievements ─────────────────────────────────────── */
export interface Achievement {
  id: string;
  key: AchievementKey;
  title: string;
  description: string;
  icon: string;
  unlocked_at: string | null;
}

export type AchievementKey =
  | 'first_win'
  | 'lucky_guess'
  | 'sharpshooter'
  | 'veteran'
  | 'streak_3'
  | 'collector_500';

/* ── Game Config ──────────────────────────────────────── */
export interface GameConfig {
  min: number;
  max: number;
  maxAttempts: number;
}

/* ── API Response ─────────────────────────────────────── */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}