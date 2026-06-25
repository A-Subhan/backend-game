// ============================================================
// Lucky Guess — Leaderboard Controller
// Contoura Labs
//
// Response: { leaderboard: [...], currentUserRank: number|null }
// Each leaderboard entry: { id, name, avatar_url, elo,
//   total_wins, total_matches, streak, rank, is_guest }
// ============================================================

const { supabaseAdmin, supabaseUnavailable } = require('../config/database');

/**
 * GET /leaderboard?limit=50
 */
async function getLeaderboard(req, res) {
  if (supabaseUnavailable(res)) return;

  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    // Only non-guest players appear on the public leaderboard.
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id, name, avatar_url, elo, total_wins, total_matches, streak, is_guest')
      .eq('is_guest', false)
      .order('elo', { ascending: false })
      .order('total_wins', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Leaderboard] Fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }

    const leaderboard = (users || []).map((u, index) => ({
      ...u,
      rank: index + 1,
      isCurrentUser: false,
    }));

    // If the caller is authenticated, find their rank and mark their row.
    let currentUserRank = null;
    if (req.user) {
      const { data: currentUser } = await supabaseAdmin
        .from('users')
        .select('elo')
        .eq('id', req.user.userId)
        .maybeSingle();

      if (currentUser) {
        const { count: higherCount } = await supabaseAdmin
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('is_guest', false)
          .gt('elo', currentUser.elo);

        currentUserRank = (higherCount || 0) + 1;
      }

      // Mark the caller's own row so the UI can highlight it.
      for (const entry of leaderboard) {
        if (entry.id === req.user.userId) {
          entry.isCurrentUser = true;
        }
      }
    }

    return res.json({ leaderboard, currentUserRank });
  } catch (error) {
    console.error('[Leaderboard] Get error:', error);
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
}

module.exports = { getLeaderboard };
