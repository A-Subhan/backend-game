// ============================================================
// Lucky Guess — Auth Routes
// Contoura Labs
//
// Mounted at root. Paths match the frontend's
// `shared/constants.ts` API map exactly.
// ============================================================

const { Router } = require('express');
const { googleLogin, guestLogin, getMe, logout } = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');

const router = Router();

// POST /auth/google/callback — exchange Google ID token for game JWT
router.post('/auth/google/callback', googleLogin);

// POST /guest — create a guest account and return JWT
// (Note: this is at ROOT, not under /auth, to match the frontend.)
router.post('/guest', guestLogin);

// GET /auth/me — fetch the current user's profile
router.get('/auth/me', authMiddleware, getMe);

// POST /auth/logout — invalidate the current session (stateless: no-op)
router.post('/auth/logout', authMiddleware, logout);

module.exports = router;
