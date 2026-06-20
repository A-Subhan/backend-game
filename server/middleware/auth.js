const jwt = require('jsonwebtoken');

// Middleware for REST API routes
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    req.userRating = payload.rating;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}

// Middleware for Socket.IO connections
function verifySocketToken(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = payload.userId;
    socket.username = payload.username;
    socket.rating = payload.rating;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
}

module.exports = { authenticateToken, verifySocketToken };