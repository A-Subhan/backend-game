const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');

// Get own profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Could not fetch profile' });
  }
});

// Update username or avatar
router.put('/me', authenticateToken, async (req, res) => {
  const { username, avatar_url } = req.body;
  try {
    const { data, error } = await supabase
      .from('users')
      .update({ username, avatar_url })
      .eq('id', req.userId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Could not update profile' });
  }
});

// Get any player's public profile
router.get('/:userId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, username, avatar_url, rating, games_played, wins, losses')
      .eq('id', req.params.userId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(404).json({ error: 'Player not found' });
  }
});

module.exports = router;