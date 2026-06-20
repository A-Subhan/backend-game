// ============================================================
// Lucky Guess — Leaderboard Controller
// Contoura Labs
// ============================================================

import { Response } from 'express';
import { supabaseAdmin } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse, User } from '@shared/types';

/**
 * GET /leaderboard
 * Return top 50 users sorted by ELO descending.
 */
export async function getLeaderboard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 50));

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
      } satisfies ApiResponse);
      return;
    }

    // If user is authenticated, find their rank
    let currentUserRank: number | null = null;
    if (req.user) {
      const { count, error: rankError } = await supabaseAdmin
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gt('elo', 0);

      if (!rankError) {
        // Get user's ELO and count how many are higher
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
    }

    // Attach rank to each user
    const leaderboard = (users || []).map((user: Record<string, unknown>, index: number) => ({
      ...(user as Partial<User>),
      rank: index + 1,
    }));

    res.json({
      success: true,
      data: {
        leaderboard,
        currentUserRank,
      },
    } satisfies ApiResponse);
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch leaderboard',
    } satisfies ApiResponse);
  }
}