/**
 * Error handler
 * 
 * Catches errors from routes and sends back JSON. In dev mode it
 * includes the stack trace which is super helpful for debugging.
 * 
 * IMPORTANT: This has to be the last middleware or it won't catch everything
 */
const { nodeEnv } = require('../config/env');
const logger = require('../utils/logger');

// Mongoose validation error → 400
const handleValidationError = (err) => ({
  status: 400,
  message: Object.values(err.errors).map((e) => e.message).join(', '),
});

// Mongoose duplicate key error → 409
const handleDuplicateKeyError = (err) => {
  const field = Object.keys(err.keyValue)[0];
  return {
    status: 409,
    message: `A record with this ${field} already exists.`,
  };
};

// Mongoose bad ObjectId → 400
const handleCastError = (err) => ({
  status: 400,
  message: `Invalid ${err.path}: ${err.value}`,
});

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  logger.error(`${req.method} ${req.originalUrl} →`, err.message);

  let status = err.status || 500;
  let message = err.message || 'Internal server error';

  // Transform known Mongoose errors into user-friendly responses
  if (err.name === 'ValidationError') {
    ({ status, message } = handleValidationError(err));
  } else if (err.code === 11000) {
    ({ status, message } = handleDuplicateKeyError(err));
  } else if (err.name === 'CastError') {
    ({ status, message } = handleCastError(err));
  }

  const response = { error: message };
  if (nodeEnv === 'development') {
    response.stack = err.stack;
  }

  res.status(status).json(response);
};

module.exports = errorHandler;
