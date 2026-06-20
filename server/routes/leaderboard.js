const express = require('express');
const router = express.Router();

// Placeholder leaderboard route
router.get('/', (req, res) => {
  res.json({ message: 'Leaderboard API is available' });
});

module.exports = router;
