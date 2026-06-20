// ============================================================
// Lucky Guess — Leaderboard Routes
// Contoura Labs
// ============================================================

import { Router } from 'express';
import { getLeaderboard } from '../controllers/leaderboardController';
import { optionalAuthMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', optionalAuthMiddleware, getLeaderboard);

export default router;