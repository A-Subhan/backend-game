// ============================================================
// Lucky Guess — Auth Middleware
// Contoura Labs
//
// JWT payload shape: { userId: string, isGuest: boolean, iat, exp }
// ============================================================

const jwt = require('jsonwebtoken');
const { env } = require('../config/env');

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}

/**
 * Strict REST auth — rejects requests without a valid JWT.
 */
function authMiddleware(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No authorization token provided' });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = {
      userId: decoded.userId,
      isGuest: decoded.isGuest ?? false,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('[Auth] Unexpected error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Optional auth — attaches user if a valid token is present,
 * but does not reject the request if absent.
 */
function optionalAuthMiddleware(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      req.user = {
        userId: decoded.userId,
        isGuest: decoded.isGuest ?? false,
      };
    } catch {
      // Token invalid — proceed without user
    }
  }
  next();
}

/**
 * Socket.IO auth middleware. The frontend connects with
 * `auth: { token }` in the handshake. On success, the socket
 * gains `socket.userId` and `socket.isGuest`.
 */
function verifySocketToken(socket, next) {
  const token = socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.isGuest = decoded.isGuest ?? false;
    next();
  } catch (err) {
    return next(new Error('Invalid or expired token'));
  }
}

module.exports = { authMiddleware, optionalAuthMiddleware, verifySocketToken };
