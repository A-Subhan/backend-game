const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');

// Called after Supabase login on the client — exchanges Supabase session for our game JWT
router.post('/session', async (req, res) => {
  const { supabase_access_token } = req.body;
  if (!supabase_access_token) return res.status(400).json({ error: 'Token required' });

  try {
    // Verify the Supabase token and get the user
    const { data: { user }, error } = await supabase.auth.getUser(supabase_access_token);
    if (error || !user) return res.status(401).json({ error: 'Invalid Supabase token' });

    // Fetch their game profile
    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Issue our own JWT for socket authentication
    const gameToken = jwt.sign(
      { userId: profile.id, username: profile.username, rating: profile.rating },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token: gameToken, profile });
  } catch (err) {
    console.error('Session error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Guest login — creates a temporary profile
router.post('/guest', async (req, res) => {
  try {
    const guestNum = Math.floor(Math.random() * 99999);
    const username = `Guest${guestNum}`;

    const { data: profile, error } = await supabase
      .from('users')
      .insert({ username, rating: 800, avatar_url: null })
      .select()
      .single();

    if (error) throw error;

    const gameToken = jwt.sign(
      { userId: profile.id, username: profile.username, rating: profile.rating, isGuest: true },
      process.env.JWT_SECRET,
      { expiresIn: '24h' } // Guests expire after 24 hours
    );

    res.json({ token: gameToken, profile });
  } catch (err) {
    console.error('Guest error:', err);
    res.status(500).json({ error: 'Could not create guest session' });
  }
});

module.exports = router;