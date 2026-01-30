/**
 * MongoDB connection setup
 * 
 * Using mongoose to connect. Added some logging so I can see what's happening
 * when stuff breaks (which it will lol)
 */
const mongoose = require('mongoose');
const { mongodbUri } = require('./env');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    await mongoose.connect(mongodbUri);
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB runtime error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
};

module.exports = connectDB;
