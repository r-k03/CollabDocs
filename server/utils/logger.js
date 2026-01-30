/**
 * Simple logger
 * 
 * Just a basic logging thing with different levels.
 */
const { nodeEnv } = require('../config/env');

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = nodeEnv === 'production' ? LOG_LEVELS.info : LOG_LEVELS.debug;

const formatMessage = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  return [prefix, message, ...args];
};

const logger = {
  error: (message, ...args) => {
    if (currentLevel >= LOG_LEVELS.error) {
      console.error(...formatMessage('error', message, ...args));
    }
  },
  warn: (message, ...args) => {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(...formatMessage('warn', message, ...args));
    }
  },
  info: (message, ...args) => {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(...formatMessage('info', message, ...args));
    }
  },
  debug: (message, ...args) => {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.log(...formatMessage('debug', message, ...args));
    }
  },
};

module.exports = logger;
