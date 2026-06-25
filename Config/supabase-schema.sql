-- ============================================================
-- Lucky Guess — Supabase PostgreSQL Schema
-- Contoura Labs
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  avatar_url    TEXT,
  coins         INTEGER NOT NULL DEFAULT 0,
  elo           INTEGER NOT NULL DEFAULT 1000,
  total_wins    INTEGER NOT NULL DEFAULT 0,
  total_losses  INTEGER NOT NULL DEFAULT 0,
  total_matches INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  best_streak   INTEGER NOT NULL DEFAULT 0,
  is_guest      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_users_elo ON public.users (elo DESC);

-- ============================================================
-- 2. MATCHES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.matches (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player1_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  player2_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  winner_id        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  mode             TEXT NOT NULL,
  secret_number    INTEGER,
  player1_attempts INTEGER NOT NULL DEFAULT 0,
  player2_attempts INTEGER DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for match history queries
CREATE INDEX IF NOT EXISTS idx_matches_player1 ON public.matches (player1_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_player2 ON public.matches (player2_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_created ON public.matches (created_at DESC);

-- ============================================================
-- 3. ROOMS TABLE (Online Multiplayer)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rooms (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player1_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  player1_name  TEXT NOT NULL,
  player2_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  player2_name  TEXT,
  secret_number    INTEGER NOT NULL,
  player1_attempts INTEGER NOT NULL DEFAULT 0,
  player2_attempts INTEGER NOT NULL DEFAULT 0,
  min_number       INTEGER NOT NULL DEFAULT 1,
  max_number    INTEGER NOT NULL DEFAULT 100,
  status        TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished', 'abandoned')),
  max_attempts  INTEGER NOT NULL DEFAULT 10,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for active room lookups
CREATE INDEX IF NOT EXISTS idx_rooms_status ON public.rooms (status);
CREATE INDEX IF NOT EXISTS idx_rooms_players ON public.rooms (player1_id, player2_id);

-- ============================================================
-- 4. ACHIEVEMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.achievements (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_achievements_user ON public.achievements (user_id);

-- ============================================================
-- 5. LEADERBOARD VIEW
-- ============================================================
CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
  u.id,
  u.name,
  u.elo,
  u.total_wins,
  u.total_matches,
  u.avatar_url,
  RANK() OVER (ORDER BY u.elo DESC) AS rank
FROM public.users u
WHERE u.is_guest = FALSE
ORDER BY u.elo DESC;

-- ============================================================
-- 6. USER STATS VIEW (for quick stat lookups)
-- ============================================================
CREATE OR REPLACE VIEW public.user_stats AS
SELECT
  u.id AS user_id,
  u.total_wins,
  u.total_losses,
  u.total_matches,
  u.elo,
  u.coins,
  u.streak,
  u.best_streak,
  CASE
    WHEN u.total_matches > 0 THEN ROUND((u.total_wins::NUMERIC / u.total_matches::NUMERIC) * 100, 1)
    ELSE 0
  END AS win_rate_percent,
  CASE
    WHEN u.total_matches > 0 THEN ROUND(AVG(m.player1_attempts + COALESCE(m.player2_attempts, 0))::NUMERIC, 1)
    ELSE 0
  END AS avg_attempts
FROM public.users u
LEFT JOIN public.matches m ON m.player1_id = u.id OR m.player2_id = u.id
GROUP BY u.id;

-- ============================================================
-- 7. SEED: Insert default achievements for each new user
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_achievements_for_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.achievements (user_id, key, title, description, icon, unlocked_at)
  VALUES
    (NEW.id, 'first_win',     'First Win',    'Win your first match',          '🏆', NULL),
    (NEW.id, 'lucky_guess',   'Lucky Guess',  'Win in exactly 1 attempt',      '🍀', NULL),
    (NEW.id, 'sharpshooter',  'Sharpshooter', 'Win in 3 or fewer attempts',    '🎯', NULL),
    (NEW.id, 'veteran',       'Veteran',      'Play 10 matches',               '🎖️', NULL),
    (NEW.id, 'streak_3',      'Streak x3',    'Win 3 matches in a row',        '🔥', NULL),
    (NEW.id, 'collector_500', 'Collector',    'Earn 500 total coins',          '💰', NULL);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_achievements_seed
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.seed_achievements_for_user();

-- ============================================================
-- 8. ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

-- Users can read all profiles but only update their own
CREATE POLICY "Users: public read" ON public.users
  FOR SELECT USING (true);

CREATE POLICY "Users: own update" ON public.users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users: self insert" ON public.users
  FOR INSERT WITH CHECK (true);

-- Matches: anyone can read, only system (service role) inserts
CREATE POLICY "Matches: public read" ON public.matches
  FOR SELECT USING (true);

CREATE POLICY "Matches: service insert" ON public.matches
  FOR INSERT WITH CHECK (true);

-- Rooms: service role only (backend manages these)
CREATE POLICY "Rooms: public read" ON public.rooms
  FOR SELECT USING (true);

CREATE POLICY "Rooms: service insert" ON public.rooms
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Rooms: service update" ON public.rooms
  FOR UPDATE USING (true);

-- Achievements: users can read their own, service role manages
CREATE POLICY "Achievements: own read" ON public.achievements
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Achievements: service insert" ON public.achievements
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Achievements: service update" ON public.achievements
  FOR UPDATE USING (true);

-- ============================================================
-- 9. HELPER FUNCTION: Get or create guest user
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_or_create_guest(guest_name TEXT)
RETURNS TABLE(id UUID, name TEXT, email TEXT, coins INTEGER, elo INTEGER, is_guest BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user RECORD;
BEGIN
  -- Try to find existing guest by name
  SELECT * INTO v_user FROM public.users WHERE name = guest_name AND is_guest = TRUE LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.users (name, is_guest)
    VALUES (guest_name, TRUE)
    RETURNING id, name, email, coins, elo, is_guest INTO v_user;
  END IF;

  RETURN QUERY SELECT v_user.id, v_user.name, v_user.email, v_user.coins, v_user.elo, v_user.is_guest;
END;
$$;

-- ============================================================
-- DONE — Schema is ready
-- ============================================================