// ============================================================
// Lucky Guess — Auth Routes
// Contoura Labs
// ============================================================

const { Router } = require('express');
const { googleLogin, guestLogin, getMe, logout } = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');

const router = Router();

router.post('/google/callback', googleLogin);
router.post('/guest', guestLogin);
router.get('/me', authMiddleware, getMe);
router.post('/logout', authMiddleware, logout);

module.exports = router;