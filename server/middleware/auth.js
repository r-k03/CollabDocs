/**
 * Auth middleware
 * 
 * Checks if the JWT token is valid and puts the user info in req.user.
 * Used on routes that need authentication.
 * 
 * WebSocket auth is different (in sockets/index.js) but uses the same
 * token verification code.
 */
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const User = require('../models/User');
const logger = require('../utils/logger');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Provide a Bearer token.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, jwtSecret);

    // Get user from DB to make sure they still exist
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists.' });
    }

    req.user = { id: user._id.toString(), username: user.username, email: user.email };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    logger.error('Auth middleware error:', error.message);
    return res.status(500).json({ error: 'Authentication failed.' });
  }
};

/**
 * Just verify the token and return what's in it
 * Used by both HTTP routes and websocket connection
 */
const verifyToken = (token) => {
  return jwt.verify(token, jwtSecret);
};

module.exports = { authenticate, verifyToken };
