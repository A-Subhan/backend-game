// ============================================================
// Lucky Guess — User Routes
// Contoura Labs
// ============================================================

import { Router } from 'express';
import { getProfile, getStats, getHistory, getAchievements } from '../controllers/userController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/profile', authMiddleware, getProfile);
router.get('/stats', authMiddleware, getStats);
router.get('/history', authMiddleware, getHistory);
router.get('/achievements', authMiddleware, getAchievements);

export default router;