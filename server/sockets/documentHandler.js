/**
 * Document websocket handlers
 * 
 * Handles real-time stuff for documents. Each client joins a room
 * named doc:<documentId>.
 * 
 * Events:
 * - join_document - join room, get doc state + who's online
 * - leave_document - leave room, cleanup
 * - operation - edit operation, goes through OT
 * - cursor_move - cursor position (throttled so it doesn't spam)
 * - disconnect - cleanup everything
 * 
 * We check permissions in each handler, not just when joining.
 * Someone's role could change while they're editing (owner revokes access)
 */
const Document = require('../models/Document');
const otService = require('../services/otService');
const permissionService = require('../services/permissionService');
const realtimeService = require('../services/realtimeService');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// Unique ID for this server instance (for Redis)
const SERVER_ID = uuidv4();

// Track who's editing each doc: Map<documentId, Map<userId, userData>>
const activeUsers = new Map();

// Throttle cursor updates so we don't spam
const CURSOR_THROTTLE_MS = 50;
const lastCursorUpdate = new Map();

/**
 * Get the active users map for a doc (create if needed)
 */
const getDocumentUsers = (documentId) => {
  if (!activeUsers.has(documentId)) {
    activeUsers.set(documentId, new Map());
  }
  return activeUsers.get(documentId);
};

/**
 * Register all the document event handlers on a socket
 */
const registerDocumentHandlers = (io, socket) => {
  const user = socket.user; // Attached during handshake auth

  /**
   * Join document room
   * Client sends: { documentId }
   * Server sends back doc state + who's online
   */
  socket.on('join_document', async ({ documentId }) => {
    try {
      // Check they have read access first
      const { document, role } = await permissionService.getDocumentWithAccess(
        documentId,
        user.id,
        'read'
      );

      const roomName = `doc:${documentId}`;
      socket.join(roomName);
      socket.documentId = documentId;

      // Track them in memory
      const users = getDocumentUsers(documentId);
      const userData = {
        userId: user.id,
        username: user.username,
        role,
        joinedAt: Date.now(),
      };
      users.set(user.id, userData);

      // Also put in Redis so other servers can see them
      await realtimeService.setPresence(documentId, user.id, userData);

      // Subscribe to Redis channels for this doc
      await realtimeService.subscribeToDocument(documentId, SERVER_ID);
      await realtimeService.subscribeToPresence(documentId, SERVER_ID);

      // Send them the current doc state
      await document.populate('owner', 'username email');
      socket.emit('document_state', {
        document: {
          _id: document._id,
          title: document.title,
          content: document.content,
          version: document.version,
          owner: document.owner,
        },
        role,
        activeUsers: Array.from(users.values()),
      });

      // Tell everyone else they joined
      socket.to(roomName).emit('user_joined', userData);

      // Also tell other servers via Redis
      await realtimeService.publishPresence(documentId, {
        serverId: SERVER_ID,
        event: 'user_joined',
        payload: userData,
      });

      logger.info(`${user.username} joined document ${documentId} as ${role}`);
    } catch (error) {
      socket.emit('error_message', { message: error.message });
      logger.error('Join document error:', error.message);
    }
  });

  /**
   * Handle edit operation
   * Client sends: { documentId, operation: { type, position, text?, length?, baseVersion } }
   * We transform it, apply it, save it, and broadcast it
   */
  socket.on('operation', async ({ documentId, operation }) => {
    try {
      // Check permission again (role could have changed)
      const doc = await Document.findById(documentId);
      if (!doc || !permissionService.canEdit(doc, user.id)) {
        socket.emit('error_message', { message: 'Edit permission denied.' });
        return;
      }

      // Make sure operation looks valid
      if (!operation || !operation.type || operation.position === undefined) {
        socket.emit('error_message', { message: 'Invalid operation format.' });
        return;
      }

      if (operation.type === 'insert' && !operation.text) {
        socket.emit('error_message', { message: 'Insert operation requires text.' });
        return;
      }

      if (operation.type === 'delete' && !operation.length) {
        socket.emit('error_message', { message: 'Delete operation requires length.' });
        return;
      }

      // Process through OT
      const { transformedOp, newVersion } = await otService.processOperation(
        documentId,
        operation,
        user.id
      );

      // Tell sender it worked
      socket.emit('operation_ack', {
        operation: transformedOp,
        version: newVersion,
        userId: user.id,
      });

      // Tell everyone else in the room
      const roomName = `doc:${documentId}`;
      socket.to(roomName).emit('remote_operation', {
        operation: transformedOp,
        version: newVersion,
        userId: user.id,
        username: user.username,
      });

      // Also tell other servers via Redis
      await realtimeService.publishOperation(documentId, {
        serverId: SERVER_ID,
        event: 'remote_operation',
        payload: {
          operation: transformedOp,
          version: newVersion,
          userId: user.id,
          username: user.username,
        },
      });
    } catch (error) {
      socket.emit('error_message', { message: 'Failed to apply operation.' });
      logger.error('Operation error:', error.message);
    }
  });

  /**
   * Cursor moved
   * Client sends: { documentId, cursor: { position, selectionRange } }
   * Throttled so we don't spam when someone is typing fast
   */
  socket.on('cursor_move', async ({ documentId, cursor }) => {
    const throttleKey = `${documentId}:${user.id}`;
    const now = Date.now();
    const lastUpdate = lastCursorUpdate.get(throttleKey) || 0;

    if (now - lastUpdate < CURSOR_THROTTLE_MS) return;
    lastCursorUpdate.set(throttleKey, now);

    const cursorData = {
      userId: user.id,
      username: user.username,
      cursor,
    };

    const roomName = `doc:${documentId}`;
    socket.to(roomName).emit('cursor_moved', cursorData);

    // Update cursor in Redis too
    const users = getDocumentUsers(documentId);
    const userData = users.get(user.id);
    if (userData) {
      userData.cursor = cursor;
      await realtimeService.setPresence(documentId, user.id, userData);
    }
  });

  /**
   * Leave document room
   * When they navigate away or close the editor
   */
  socket.on('leave_document', async ({ documentId }) => {
    await handleUserLeave(io, socket, documentId, user);
  });

  /**
   * Disconnected
   * Clean up everything
   */
  socket.on('disconnect', async () => {
    if (socket.documentId) {
      await handleUserLeave(io, socket, socket.documentId, user);
    }
    logger.info(`${user.username} disconnected`);
  });
};

/**
 * Handle when someone leaves a doc
 * Clean up their presence stuff
 */
const handleUserLeave = async (io, socket, documentId, user) => {
  const roomName = `doc:${documentId}`;
  socket.leave(roomName);

  const users = getDocumentUsers(documentId);
  users.delete(user.id);

  // Remove from Redis too
  await realtimeService.removePresence(documentId, user.id);

  // Clean up cursor throttle
  lastCursorUpdate.delete(`${documentId}:${user.id}`);

  const leaveData = { userId: user.id, username: user.username };

  // Tell everyone else they left
  socket.to(roomName).emit('user_left', leaveData);

  // Tell other servers
  await realtimeService.publishPresence(documentId, {
    serverId: SERVER_ID,
    event: 'user_left',
    payload: leaveData,
  });

  // If no one is editing anymore, clean up
  if (users.size === 0) {
    activeUsers.delete(documentId);
    otService.clearBuffer(documentId);
    await realtimeService.unsubscribeFromDocument(documentId);
    logger.debug(`Document ${documentId} room emptied, cleaned up resources`);
  }

  logger.info(`${user.username} left document ${documentId}`);
};

module.exports = { registerDocumentHandlers };
