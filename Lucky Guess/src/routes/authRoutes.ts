// ============================================================
// Lucky Guess — Auth Routes
// Contoura Labs
// ============================================================

import { Router } from 'express';
import { googleLogin, guestLogin, getMe, logout } from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/google/callback', googleLogin);
router.post('/guest', guestLogin);
router.get('/me', authMiddleware, getMe);
router.post('/logout', authMiddleware, logout);

export default router;