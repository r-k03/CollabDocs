/**
 * Redis client stuff
 * 
 * Need separate clients for pub/sub because redis is weird - once you subscribe
 * to a channel you can't do other commands on that same connection. So we need
 * different ones for publishing vs subscribing.
 */
const { createClient } = require('redis');
const { redisOptions } = require('./env');
const logger = require('../utils/logger');

let pubClient = null;
let subClient = null;
let cacheClient = null;

const createRedisClient = async (name) => {
  const client = createClient(redisOptions);

  client.on('error', (err) => {
    logger.error(`Redis ${name} client error:`, err.message);
  });

  client.on('connect', () => {
    logger.info(`Redis ${name} client connected`);
  });

  await client.connect();
  return client;
};

const getClients = async () => {
  if (!pubClient) {
    pubClient = await createRedisClient('publisher');
    subClient = await createRedisClient('subscriber');
    cacheClient = await createRedisClient('cache');
  }
  return { pubClient, subClient, cacheClient };
};

module.exports = { getClients };
