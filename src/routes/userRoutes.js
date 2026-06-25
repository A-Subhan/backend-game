// ============================================================
// Lucky Guess — User Routes
// Contoura Labs
//
// Mounted at root. Paths match the frontend's
// `shared/constants.ts` API map exactly.
// ============================================================

const { Router } = require('express');
const { getProfile, getStats, getHistory, getAchievements } = require('../controllers/userController');
const { authMiddleware } = require('../middleware/auth');

const router = Router();

router.get('/user/profile', authMiddleware, getProfile);
router.get('/user/stats', authMiddleware, getStats);
router.get('/user/history', authMiddleware, getHistory);
router.get('/user/achievements', authMiddleware, getAchievements);

module.exports = router;
