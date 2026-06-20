// ============================================================
// Lucky Guess — User Controller
// Contoura Labs
// ============================================================

import { Response } from 'express';
import { supabaseAdmin } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse, User, Achievement, MatchRecord } from '@shared/types';
import { ACHIEVEMENTS } from '@shared/constants';

/**
 * GET /user/profile
 * Full user profile with achievements and recent match history.
 */
export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' } satisfies ApiResponse);
      return;
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .single();

    if (userError || !user) {
      res.status(404).json({ success: false, error: 'User not found' } satisfies ApiResponse);
      return;
    }

    // Fetch unlocked achievements for this user
    const { data: unlockedAchievements, error: achError } = await supabaseAdmin
      .from('user_achievements')
      .select('achievement_key, unlocked_at')
      .eq('user_id', req.user.userId);

    const unlockedKeys = new Set(
      (unlockedAchievements || []).map((a: { achievement_key: string }) => a.achievement_key)
    );

    const achievements: Achievement[] = ACHIEVEMENTS.map((def) => {
      const unlocked = unlockedKeys.has(def.key);
      const userAch = (unlockedAchievements || []).find(
        (a: { achievement_key: string }) => a.achievement_key === def.key
      );
      return {
        id: `${req.user!.userId}_${def.key}`,
        key: def.key,
        title: def.title,
        description: def.description,
        icon: def.icon,
        unlocked_at: userAch ? userAch.unlocked_at : null,
      };
    });

    // Fetch recent match history (last 20)
    const { data: matchRecords, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .or(`player1_id.eq.${req.user.userId},player2_id.eq.${req.user.userId}`)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({
      success: true,
      data: {
        ...(user as User),
        achievements,
        match_history: (matchRecords || []) as MatchRecord[],
      },
    } satisfies ApiResponse);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch profile' } satisfies ApiResponse);
  }
}

/**
 * GET /user/stats
 * User statistics summary.
 */
export async function getStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' } satisfies ApiResponse);
      return;
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('elo, total_wins, total_losses, total_matches, streak, best_streak, coins, created_at')
      .eq('id', req.user.userId)
      .single();

    if (error || !user) {
      res.status(404).json({ success: false, error: 'User not found' } satisfies ApiResponse);
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
    } satisfies ApiResponse);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' } satisfies ApiResponse);
  }
}

/**
 * GET /user/history
 * Paginated match history, newest first.
 */
export async function getHistory(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' } satisfies ApiResponse);
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const offset = (page - 1) * limit;

    const { data: matches, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('*')
      .or(`player1_id.eq.${req.user.userId},player2_id.eq.${req.user.userId}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (matchError) {
      console.error('Fetch match history error:', matchError);
      res.status(500).json({ success: false, error: 'Failed to fetch match history' } satisfies ApiResponse);
      return;
    }

    // Get total count for pagination
    const { count, error: countError } = await supabaseAdmin
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .or(`player1_id.eq.${req.user.userId},player2_id.eq.${req.user.userId}`);

    res.json({
      success: true,
      data: {
        matches: (matches || []) as MatchRecord[],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
      },
    } satisfies ApiResponse);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch match history' } satisfies ApiResponse);
  }
}

/**
 * GET /user/achievements
 * All achievements with unlock status for the current user.
 */
export async function getAchievements(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' } satisfies ApiResponse);
      return;
    }

    // Fetch unlocked achievements
    const { data: unlockedAchievements, error: achError } = await supabaseAdmin
      .from('user_achievements')
      .select('achievement_key, unlocked_at')
      .eq('user_id', req.user.userId);

    if (achError) {
      console.error('Fetch achievements error:', achError);
      res.status(500).json({ success: false, error: 'Failed to fetch achievements' } satisfies ApiResponse);
      return;
    }

    const unlockedMap = new Map(
      (unlockedAchievements || []).map((a: { achievement_key: string; unlocked_at: string }) => [
        a.achievement_key,
        a.unlocked_at,
      ])
    );

    const achievements: Achievement[] = ACHIEVEMENTS.map((def) => ({
      id: `${req.user!.userId}_${def.key}`,
      key: def.key,
      title: def.title,
      description: def.description,
      icon: def.icon,
      unlocked_at: unlockedMap.get(def.key) || null,
    }));

    res.json({
      success: true,
      data: achievements,
    } satisfies ApiResponse);
  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch achievements' } satisfies ApiResponse);
  }
}