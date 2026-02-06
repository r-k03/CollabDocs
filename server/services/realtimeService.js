/**
 * Redis pub/sub for scaling
 * 
 * This lets multiple server instances stay in sync. When someone edits on server A:
 * 1. Server A applies it and tells its clients
 * 2. Server A publishes to Redis channel
 * 3. Server B (and others) get the message
 * 4. They tell their clients
 * 
 * This way everyone sees updates even if they're on different servers.
 */
const { getClients } = require('../config/redis');
const logger = require('../utils/logger');

// Keep track of what we're subscribed to so we don't subscribe twice
const activeSubscriptions = new Set();

// set when server starts
let ioInstance = null;

/**
 * Set the socket.io instance
 * Called when server starts
 */
const init = (io) => {
  ioInstance = io;
};

/**
 * Get channel name for a doc
 */
const getChannelName = (documentId) => `doc:${documentId}`;

/**
 * Publish an operation to Redis
 * Called after we apply it locally
 */
const publishOperation = async (documentId, data) => {
  try {
    const { pubClient } = await getClients();
    const channel = getChannelName(documentId);
    await pubClient.publish(channel, JSON.stringify(data));
    logger.debug(`Published to ${channel}`);
  } catch (error) {
    logger.error('Redis publish error:', error.message);
  }
};

/**
 * Publish events (user joined/left, cursor moved).
 */
const publishPresence = async (documentId, data) => {
  try {
    const { pubClient } = await getClients();
    const channel = `presence:${documentId}`;
    await pubClient.publish(channel, JSON.stringify(data));
  } catch (error) {
    logger.error('Redis presence publish error:', error.message);
  }
};

/**
 * Subscribe to a document's operation channel.
 * Incoming messages are broadcast to the document room,
 * but only to clients NOT on the originating server instance.
 */
const subscribeToDocument = async (documentId, serverId) => {
  const channel = getChannelName(documentId);

  if (activeSubscriptions.has(channel)) return;

  try {
    const { subClient } = await getClients();

    await subClient.subscribe(channel, (message) => {
      try {
        const data = JSON.parse(message);

        // Skip if this message is from our own server
        // to avoid double-broadcasting
        if (data.serverId === serverId) return;

        // Broadcast to all clients in the document room on this server
        if (ioInstance) {
          ioInstance.to(`doc:${documentId}`).emit(data.event, data.payload);
        }
      } catch (err) {
        logger.error('Redis message parse error:', err.message);
      }
    });

    activeSubscriptions.add(channel);
    logger.debug(`Subscribed to ${channel}`);
  } catch (error) {
    logger.error('Redis subscribe error:', error.message);
  }
};

/**
 * Subscribe to presence events for a document.
 */
const subscribeToPresence = async (documentId, serverId) => {
  const channel = `presence:${documentId}`;

  if (activeSubscriptions.has(channel)) return;

  try {
    const { subClient } = await getClients();

    await subClient.subscribe(channel, (message) => {
      try {
        const data = JSON.parse(message);
        if (data.serverId === serverId) return;

        if (ioInstance) {
          ioInstance.to(`doc:${documentId}`).emit(data.event, data.payload);
        }
      } catch (err) {
        logger.error('Redis presence parse error:', err.message);
      }
    });

    activeSubscriptions.add(channel);
  } catch (error) {
    logger.error('Redis presence subscribe error:', error.message);
  }
};

/**
 * Unsubscribe from document channels when no clients remain.
 */
const unsubscribeFromDocument = async (documentId) => {
  const opChannel = getChannelName(documentId);
  const presenceChannel = `presence:${documentId}`;

  try {
    const { subClient } = await getClients();

    if (activeSubscriptions.has(opChannel)) {
      await subClient.unsubscribe(opChannel);
      activeSubscriptions.delete(opChannel);
    }
    if (activeSubscriptions.has(presenceChannel)) {
      await subClient.unsubscribe(presenceChannel);
      activeSubscriptions.delete(presenceChannel);
    }

    logger.debug(`Unsubscribed from doc ${documentId} channels`);
  } catch (error) {
    logger.error('Redis unsubscribe error:', error.message);
  }
};

/**
 * Store/update presence data in Redis for cross-instance visibility.
 */
const setPresence = async (documentId, userId, presenceData) => {
  try {
    const { cacheClient } = await getClients();
    const key = `presence:${documentId}:${userId}`;
    await cacheClient.set(key, JSON.stringify(presenceData), { EX: 300 }); // 5 min TTL
  } catch (error) {
    logger.error('Redis set presence error:', error.message);
  }
};

/**
 * Remove presence data when user disconnects.
 */
const removePresence = async (documentId, userId) => {
  try {
    const { cacheClient } = await getClients();
    await cacheClient.del(`presence:${documentId}:${userId}`);
  } catch (error) {
    logger.error('Redis remove presence error:', error.message);
  }
};

/**
 * Get all active users in a document across all server instances.
 */
const getDocumentPresence = async (documentId) => {
  try {
    const { cacheClient } = await getClients();
    const keys = await cacheClient.keys(`presence:${documentId}:*`);
    const presence = [];

    for (const key of keys) {
      const data = await cacheClient.get(key);
      if (data) {
        presence.push(JSON.parse(data));
      }
    }

    return presence;
  } catch (error) {
    logger.error('Redis get presence error:', error.message);
    return [];
  }
};

module.exports = {
  init,
  publishOperation,
  publishPresence,
  subscribeToDocument,
  subscribeToPresence,
  unsubscribeFromDocument,
  setPresence,
  removePresence,
  getDocumentPresence,
};
