// ============================================================
// Lucky Guess — Leaderboard Routes
// Contoura Labs
// ============================================================

const { Router } = require('express');
const { getLeaderboard } = require('../controllers/leaderboardController');
const { optionalAuthMiddleware } = require('../middleware/auth');

const router = Router();

// GET /leaderboard — top players by ELO
router.get('/leaderboard', optionalAuthMiddleware, getLeaderboard);

module.exports = router;
