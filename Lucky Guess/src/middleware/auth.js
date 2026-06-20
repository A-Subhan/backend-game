// ============================================================
// Lucky Guess — Auth Middleware
// Contoura Labs
// ============================================================

const jwt = require('jsonwebtoken');
const { env } = require('../config/env');

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'No authorization token provided',
      });
      return;
    }

    const token = authHeader.substring(7);

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Empty authorization token',
      });
      return;
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);

    req.user = {
      userId: decoded.userId,
      isGuest: decoded.isGuest ?? false,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: 'Internal server error during authentication',
    });
  }
}

/**
 * Optional auth — attaches user if token present, but does not block.
 */
function optionalAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (token) {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        req.user = {
          userId: decoded.userId,
          isGuest: decoded.isGuest ?? false,
        };
      }
    }
  } catch {
    // Token invalid or expired — proceed without user
  }
  next();
}

module.exports = { authMiddleware, optionalAuthMiddleware };