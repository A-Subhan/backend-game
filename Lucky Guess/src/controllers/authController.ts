// ============================================================
// Lucky Guess — Auth Controller
// Contoura Labs
// ============================================================

import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../config/database';
import { env } from '../config/env';
import { ApiResponse, User } from '@shared/types';
import { ELO_INITIAL } from '@shared/constants';
import { AuthRequest } from '../middleware/auth';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

function generateJwt(userId: string, isGuest: boolean): string {
  return jwt.sign(
    { userId, isGuest },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

/**
 * POST /auth/google/callback
 * Verify Google ID token, upsert user, return JWT.
 */
export async function googleLogin(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.body as { token?: string };

    if (!token) {
      res.status(400).json({
        success: false,
        error: 'Google ID token is required',
      } satisfies ApiResponse);
      return;
    }

    // Verify the Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.sub) {
      res.status(400).json({
        success: false,
        error: 'Invalid Google token payload',
      } satisfies ApiResponse);
      return;
    }

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || email.split('@')[0];
    const avatarUrl = payload.picture || null;

    // Upsert user into Supabase
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .single();

    let user: User;

    if (fetchError || !existingUser) {
      // Insert new user
      const newUserId = uuidv4();
      const { data: insertedUser, error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          id: newUserId,
          google_id: googleId,
          name,
          email,
          avatar_url: avatarUrl,
          coins: 0,
          elo: ELO_INITIAL,
          total_wins: 0,
          total_losses: 0,
          total_matches: 0,
          streak: 0,
          best_streak: 0,
          is_guest: false,
        })
        .select()
        .single();

      if (insertError || !insertedUser) {
        console.error('Failed to insert user:', insertError);
        res.status(500).json({
          success: false,
          error: 'Failed to create user account',
        } satisfies ApiResponse);
        return;
      }

      user = insertedUser as User;
    } else {
      // Update existing user's name/avatar if changed
      const updates: Record<string, unknown> = {};
      if (payload.name && payload.name !== existingUser.name) updates.name = payload.name;
      if (payload.picture && payload.picture !== existingUser.avatar_url) updates.avatar_url = payload.picture;

      if (Object.keys(updates).length > 0) {
        const { data: updatedUser, error: updateError } = await supabaseAdmin
          .from('users')
          .update(updates)
          .eq('id', existingUser.id)
          .select()
          .single();

        if (!updateError && updatedUser) {
          user = updatedUser as User;
        } else {
          user = existingUser as User;
        }
      } else {
        user = existingUser as User;
      }
    }

    const jwtToken = generateJwt(user.id, false);

    res.json({
      success: true,
      data: {
        token: jwtToken,
        user,
      },
    } satisfies ApiResponse);
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
    } satisfies ApiResponse);
  }
}

/**
 * POST /auth/guest
 * Create a guest user account, return JWT with isGuest: true.
 */
export async function guestLogin(req: Request, res: Response): Promise<void> {
  try {
    // Generate a random guest name
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const guestName = `Guest_${randomSuffix}`;

    const guestId = uuidv4();

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert({
        id: guestId,
        name: guestName,
        email: null,
        avatar_url: null,
        coins: 0,
        elo: ELO_INITIAL,
        total_wins: 0,
        total_losses: 0,
        total_matches: 0,
        streak: 0,
        best_streak: 0,
        is_guest: true,
      })
      .select()
      .single();

    if (error || !user) {
      console.error('Failed to create guest user:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create guest account',
      } satisfies ApiResponse);
      return;
    }

    const jwtToken = generateJwt(user.id, true);

    res.json({
      success: true,
      data: {
        token: jwtToken,
        user: user as User,
      },
    } satisfies ApiResponse);
  } catch (error) {
    console.error('Guest login error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create guest account',
    } satisfies ApiResponse);
  }
}

/**
 * GET /auth/me
 * Return the current authenticated user's profile.
 */
export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
      } satisfies ApiResponse);
      return;
    }

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .single();

    if (error || !user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
      } satisfies ApiResponse);
      return;
    }

    res.json({
      success: true,
      data: user as User,
    } satisfies ApiResponse);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile',
    } satisfies ApiResponse);
  }
}

/**
 * POST /auth/logout
 * Client-side token removal. No server-side session to invalidate
 * since we use stateless JWT.
 */
export async function logout(_req: AuthRequest, res: Response): Promise<void> {
  res.json({
    success: true,
    data: { message: 'Logged out successfully' },
  } satisfies ApiResponse);
}