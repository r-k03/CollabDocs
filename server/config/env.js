/**
 * Environment config stuff
 * 
 * Basically just keeps all the env vars in one place so I don't have to
 * look for process.env everywhere. Makes it easier to change stuff.
 */
const path = require('path');

// Need to find .env from the root since we're in /server folder
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Redis: host, port, username, password (e.g. Redis Cloud format)
const redisOptions = {
  username: process.env.REDIS_USERNAME || 'default',
  password: process.env.REDIS_PASSWORD || '',
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  },
};

module.exports = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/collab-docs',
  redisOptions,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
};
