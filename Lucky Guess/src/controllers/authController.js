// ============================================================
// Lucky Guess — Auth Controller
// Contoura Labs
//
// All responses are FLAT (no `{ success, data }` wrapper) to
// match the frontend's expected shapes:
//   - login endpoints → { user, token }
//   - getMe           → user object
//   - logout          → { message }
// ============================================================

const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin, supabaseUnavailable } = require('../config/database');
const { env } = require('../config/env');
const { ELO_INITIAL } = require('../../shared/constants');

let googleClient = null;
if (env.GOOGLE_CLIENT_ID) {
  googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);
}

function generateJwt(userId, isGuest) {
  return jwt.sign(
    { userId, isGuest: !!isGuest },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

/**
 * Shape the user row for the frontend `User` interface.
 */
function shapeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    coins: row.coins ?? 0,
    elo: row.elo ?? ELO_INITIAL,
    total_wins: row.total_wins ?? 0,
    total_losses: row.total_losses ?? 0,
    total_matches: row.total_matches ?? 0,
    streak: row.streak ?? 0,
    best_streak: row.best_streak ?? 0,
    is_guest: row.is_guest ?? false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * POST /auth/google/callback
 * Body: { token: <google id token> }
 * Response: { user, token }
 */
async function googleLogin(req, res) {
  if (supabaseUnavailable(res)) return;
  if (!googleClient) {
    return res.status(503).json({ error: 'Google Sign-In is not configured on the server' });
  }

  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Google ID token is required' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.sub) {
      return res.status(400).json({ error: 'Invalid Google token payload' });
    }

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || email.split('@')[0];
    const avatarUrl = payload.picture || null;

    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .maybeSingle();

    let userRow;

    if (fetchError || !existingUser) {
      const newUserId = uuidv4();
      const { data: inserted, error: insertError } = await supabaseAdmin
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

      if (insertError || !inserted) {
        console.error('[Auth] Failed to insert Google user:', insertError);
        return res.status(500).json({ error: 'Failed to create user account' });
      }
      userRow = inserted;
    } else {
      const updates = {};
      if (payload.name && payload.name !== existingUser.name) updates.name = payload.name;
      if (payload.picture && payload.picture !== existingUser.avatar_url) updates.avatar_url = payload.picture;

      if (Object.keys(updates).length > 0) {
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('users')
          .update(updates)
          .eq('id', existingUser.id)
          .select()
          .single();

        userRow = (!updateError && updated) ? updated : existingUser;
      } else {
        userRow = existingUser;
      }
    }

    const jwtToken = generateJwt(userRow.id, false);
    return res.json({ user: shapeUser(userRow), token: jwtToken });
  } catch (error) {
    console.error('[Auth] Google login error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * POST /guest
 * Response: { user, token }
 */
async function guestLogin(req, res) {
  if (supabaseUnavailable(res)) return;

  try {
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const guestName = `Guest_${randomSuffix}`;
    const guestId = uuidv4();

    const { data: row, error } = await supabaseAdmin
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

    if (error || !row) {
      console.error('[Auth] Failed to create guest user:', error);
      return res.status(500).json({ error: 'Failed to create guest account' });
    }

    const jwtToken = generateJwt(row.id, true);
    return res.json({ user: shapeUser(row), token: jwtToken });
  } catch (error) {
    console.error('[Auth] Guest login error:', error);
    return res.status(500).json({ error: 'Failed to create guest account' });
  }
}

/**
 * GET /auth/me
 * Response: user object (flat)
 */
async function getMe(req, res) {
  if (supabaseUnavailable(res)) return;

  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { data: row, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .maybeSingle();

    if (error || !row) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(shapeUser(row));
  } catch (error) {
    console.error('[Auth] Get me error:', error);
    return res.status(500).json({ error: 'Failed to fetch user profile' });
  }
}

/**
 * POST /auth/logout
 * Stateless JWT — just tell the client to drop the token.
 */
async function logout(_req, res) {
  return res.json({ message: 'Logged out successfully' });
}

module.exports = { googleLogin, guestLogin, getMe, logout, shapeUser };
