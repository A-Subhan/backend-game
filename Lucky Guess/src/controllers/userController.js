// ============================================================
// Lucky Guess — User Controller
// Contoura Labs
// ============================================================

const { supabaseAdmin } = require('../config/database');
const { ACHIEVEMENTS } = require('../../shared/constants');

/**
 * GET /user/profile
 */
async function getProfile(req, res) {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .single();

    if (userError || !user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Fetch unlocked achievements for this user
    const { data: unlockedAchievements } = await supabaseAdmin
      .from('user_achievements')
      .select('achievement_key, unlocked_at')
      .eq('user_id', req.user.userId);

    const unlockedKeys = new Set(
      (unlockedAchievements || []).map(a => a.achievement_key)
    );

    const achievements = ACHIEVEMENTS.map((def) => {
      const unlocked = unlockedKeys.has(def.key);
      const userAch = (unlockedAchievements || []).find(
        a => a.achievement_key === def.key
      );
      return {
        id: `${req.user.userId}_${def.key}`,
        key: def.key,
        title: def.title,
        description: def.description,
        icon: def.icon,
        unlocked_at: userAch ? userAch.unlocked_at : null,
      };
    });

    // Fetch recent match history (last 20)
    const { data: matchRecords } = await supabaseAdmin
      .from('matches')
      .select('*')
      .or(`player1_id.eq.${req.user.userId},player2_id.eq.${req.user.userId}`)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({
      success: true,
      data: {
        ...user,
        achievements,
        match_history: matchRecords || [],
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
}

/**
 * GET /user/stats
 */
async function getStats(req, res) {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('elo, total_wins, total_losses, total_matches, streak, best_streak, coins, created_at')
      .eq('id', req.user.userId)
      .single();

    if (error || !user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const winRate = user.total_matches > 0
      ? Math.round((user.total_wins / user.total_matches) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        ...user,
        win_rate: winRate,
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
}

/**
 * GET /user/history
 */
async function getHistory(req, res) {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
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
      console.error('Fetch match history error:', matchError);
      res.status(500).json({ success: false, error: 'Failed to fetch match history' });
      return;
    }

    const { count } = await supabaseAdmin
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .or(`player1_id.eq.${req.user.userId},player2_id.eq.${req.user.userId}`);

    res.json({
      success: true,
      data: {
        matches: matches || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
      },
    });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch match history' });
  }
}

/**
 * GET /user/achievements
 */
async function getAchievements(req, res) {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    const { data: unlockedAchievements, error: achError } = await supabaseAdmin
      .from('user_achievements')
      .select('achievement_key, unlocked_at')
      .eq('user_id', req.user.userId);

    if (achError) {
      console.error('Fetch achievements error:', achError);
      res.status(500).json({ success: false, error: 'Failed to fetch achievements' });
      return;
    }

    const unlockedMap = new Map(
      (unlockedAchievements || []).map(a => [a.achievement_key, a.unlocked_at])
    );

    const achievements = ACHIEVEMENTS.map((def) => ({
      id: `${req.user.userId}_${def.key}`,
      key: def.key,
      title: def.title,
      description: def.description,
      icon: def.icon,
      unlocked_at: unlockedMap.get(def.key) || null,
    }));

    res.json({
      success: true,
      data: achievements,
    });
  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch achievements' });
  }
}

module.exports = { getProfile, getStats, getHistory, getAchievements };