// ============================================================
// Lucky Guess — Auth Controller
// Contoura Labs
// ============================================================

const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../config/database');
const { env } = require('../config/env');
const { ELO_INITIAL } = require('../../shared/constants');

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

function generateJwt(userId, isGuest) {
  return jwt.sign(
    { userId, isGuest },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

/**
 * POST /auth/google/callback
 */
async function googleLogin(req, res) {
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({
        success: false,
        error: 'Google ID token is required',
      });
      return;
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.sub) {
      res.status(400).json({
        success: false,
        error: 'Invalid Google token payload',
      });
      return;
    }

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || email.split('@')[0];
    const avatarUrl = payload.picture || null;

    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .single();

    let user;

    if (fetchError || !existingUser) {
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
        });
        return;
      }

      user = insertedUser;
    } else {
      const updates = {};
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
          user = updatedUser;
        } else {
          user = existingUser;
        }
      } else {
        user = existingUser;
      }
    }

    const jwtToken = generateJwt(user.id, false);

    res.json({
      success: true,
      data: {
        token: jwtToken,
        user,
      },
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
    });
  }
}

/**
 * POST /auth/guest
 */
async function guestLogin(req, res) {
  try {
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
      });
      return;
    }

    const jwtToken = generateJwt(user.id, true);

    res.json({
      success: true,
      data: {
        token: jwtToken,
        user,
      },
    });
  } catch (error) {
    console.error('Guest login error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create guest account',
    });
  }
}

/**
 * GET /auth/me
 */
async function getMe(req, res) {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
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
      });
      return;
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile',
    });
  }
}

/**
 * POST /auth/logout
 */
async function logout(req, res) {
  res.json({
    success: true,
    data: { message: 'Logged out successfully' },
  });
}

module.exports = { googleLogin, guestLogin, getMe, logout };