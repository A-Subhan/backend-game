// ============================================================
// Lucky Guess — User Controller
// Contoura Labs
//
// Response shapes match the frontend:
//   - getProfile     → { ...user, achievements, match_history }
//   - getStats       → { ...stats, win_rate }
//   - getHistory     → { matches: [...] }
//   - getAchievements→ { achievements: [...] }
// ============================================================

const { supabaseAdmin, supabaseUnavailable } = require('../config/database');
const { ACHIEVEMENTS } = require('../../shared/constants');
const { shapeUser } = require('./authController');

/**
 * Build the achievements list for a user, merging the static
 * definitions with the user's unlocked_at timestamps.
 */
function buildAchievements(userId, unlockedRows) {
  const unlockedMap = new Map(
    (unlockedRows || []).map(a => [a.achievement_key, a.unlocked_at])
  );

  return ACHIEVEMENTS.map(def => ({
    id: `${userId}_${def.key}`,
    key: def.key,
    title: def.title,
    description: def.description,
    icon: def.icon,
    unlocked_at: unlockedMap.get(def.key) || null,
  }));
}

/**
 * GET /user/profile
 * Response: { ...user, achievements, match_history }
 */
async function getProfile(req, res) {
  if (supabaseUnavailable(res)) return;

  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { data: userRow, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .maybeSingle();

    if (userError || !userRow) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch unlocked achievements — table is `user_achievements`
    // (see schema seed function). Fall back to `achievements` table
    // for older installations.
    let unlockedRows = [];
    const { data: uaRows } = await supabaseAdmin
      .from('user_achievements')
      .select('achievement_key, unlocked_at')
      .eq('user_id', req.user.userId);

    if (uaRows && uaRows.length > 0) {
      unlockedRows = uaRows;
    } else {
      const { data: aRows } = await supabaseAdmin
        .from('achievements')
        .select('key, unlocked_at')
        .eq('user_id', req.user.userId);
      if (aRows) unlockedRows = aRows.map(r => ({ achievement_key: r.key, unlocked_at: r.unlocked_at }));
    }

    const achievements = buildAchievements(req.user.userId, unlockedRows);

    // Recent match history (last 20)
    const { data: matchRecords } = await supabaseAdmin
      .from('matches')
      .select('*')
      .or(`player1_id.eq.${req.user.userId},player2_id.eq.${req.user.userId}`)
      .order('created_at', { ascending: false })
      .limit(20);

    return res.json({
      ...shapeUser(userRow),
      achievements,
      match_history: matchRecords || [],
    });
  } catch (error) {
    console.error('[User] Get profile error:', error);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

/**
 * GET /user/stats
 * Response: { ...stats, win_rate }
 */
async function getStats(req, res) {
  if (supabaseUnavailable(res)) return;

  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { data: row, error } = await supabaseAdmin
      .from('users')
      .select('elo, total_wins, total_losses, total_matches, streak, best_streak, coins, created_at')
      .eq('id', req.user.userId)
      .maybeSingle();

    if (error || !row) {
      return res.status(404).json({ error: 'User not found' });
    }

    const winRate = row.total_matches > 0
      ? Math.round((row.total_wins / row.total_matches) * 100)
      : 0;

    return res.json({ ...row, win_rate: winRate });
  } catch (error) {
    console.error('[User] Get stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
}

/**
 * GET /user/history?page=1&limit=20
 * Response: { matches: [...], pagination: {...} }
 */
async function getHistory(req, res) {
  if (supabaseUnavailable(res)) return;

  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const { data: matches, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .or(`player1_id.eq.${req.user.userId},player2_id.eq.${req.user.userId}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (matchError) {
      console.error('[User] Fetch match history error:', matchError);
      return res.status(500).json({ error: 'Failed to fetch match history' });
    }

    const { count } = await supabaseAdmin
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .or(`player1_id.eq.${req.user.userId},player2_id.eq.${req.user.userId}`);

    return res.json({
      matches: matches || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('[User] Get history error:', error);
    return res.status(500).json({ error: 'Failed to fetch match history' });
  }
}

/**
 * GET /user/achievements
 * Response: { achievements: [...] }
 */
async function getAchievements(req, res) {
  if (supabaseUnavailable(res)) return;

  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let unlockedRows = [];
    const { data: uaRows, error: uaError } = await supabaseAdmin
      .from('user_achievements')
      .select('achievement_key, unlocked_at')
      .eq('user_id', req.user.userId);

    if (!uaError && uaRows && uaRows.length > 0) {
      unlockedRows = uaRows;
    } else {
      const { data: aRows } = await supabaseAdmin
        .from('achievements')
        .select('key, unlocked_at')
        .eq('user_id', req.user.userId);
      if (aRows) unlockedRows = aRows.map(r => ({ achievement_key: r.key, unlocked_at: r.unlocked_at }));
    }

    const achievements = buildAchievements(req.user.userId, unlockedRows);
    return res.json({ achievements });
  } catch (error) {
    console.error('[User] Get achievements error:', error);
    return res.status(500).json({ error: 'Failed to fetch achievements' });
  }
}

module.exports = { getProfile, getStats, getHistory, getAchievements, buildAchievements };
