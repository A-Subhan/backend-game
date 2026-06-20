// ============================================================
// Lucky Guess — Leaderboard Controller
// Contoura Labs
// ============================================================

const { supabaseAdmin } = require('../config/database');

/**
 * GET /leaderboard
 * Return top 50 users sorted by ELO descending.
 */
async function getLeaderboard(req, res) {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id, name, avatar_url, elo, total_wins, total_matches, streak')
      .order('elo', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Fetch leaderboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch leaderboard',
      });
      return;
    }

    // If user is authenticated, find their rank
    let currentUserRank = null;
    if (req.user) {
      const { data: currentUser } = await supabaseAdmin
        .from('users')
        .select('elo')
        .eq('id', req.user.userId)
        .single();

      if (currentUser) {
        const { count: higherCount } = await supabaseAdmin
          .from('users')
          .select('*', { count: 'exact', head: true })
          .gt('elo', currentUser.elo);

        currentUserRank = (higherCount || 0) + 1;
      }
    }

    // Attach rank to each user
    const leaderboard = (users || []).map((user, index) => ({
      ...user,
      rank: index + 1,
    }));

    res.json({
      success: true,
      data: {
        leaderboard,
        currentUserRank,
      },
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch leaderboard',
    });
  }
}

module.exports = { getLeaderboard };