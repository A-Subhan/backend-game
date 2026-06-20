// ============================================================
// Lucky Guess — User Routes
// Contoura Labs
// ============================================================

const { Router } = require('express');
const { getProfile, getStats, getHistory, getAchievements } = require('../controllers/userController');
const { authMiddleware } = require('../middleware/auth');

const router = Router();

router.get('/profile', authMiddleware, getProfile);
router.get('/stats', authMiddleware, getStats);
router.get('/history', authMiddleware, getHistory);
router.get('/achievements', authMiddleware, getAchievements);

module.exports = router;