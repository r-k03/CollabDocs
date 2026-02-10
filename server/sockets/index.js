/**
 * Socket.IO setup
 * 
 * Sets up websockets with:
 * 1. Auth during handshake (no unauthenticated connections)
 * 2. Register handlers for each socket
 * 
 * We auth during handshake instead of waiting for first message because
 * otherwise people could connect without auth and waste resources. Token
 * comes in the handshake auth or query params.
 */
const { Server } = require('socket.io');
const { verifyToken } = require('../middleware/auth');
const User = require('../models/User');
const { registerDocumentHandlers } = require('./documentHandler');
const realtimeService = require('../services/realtimeService');
const { clientUrl } = require('../config/env');
const logger = require('../utils/logger');

const initializeSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: clientUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Connection quality settings
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Give realtime service the io instance
  realtimeService.init(io);

  /**
   * Auth middleware - runs when someone tries to connect
   * Rejects connection if token is bad
   */
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId);

      if (!user) {
        return next(new Error('User not found'));
      }

      // Put user info on socket so handlers can use it
      socket.user = {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
      };

      next();
    } catch (error) {
      logger.error('Socket auth error:', error.message);
      next(new Error('Authentication failed'));
    }
  });

  /**
   * When someone connects, register all the document handlers
   */
  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.user.username} (${socket.id})`);
    registerDocumentHandlers(io, socket);
  });

  return io;
};

module.exports = { initializeSocket };
