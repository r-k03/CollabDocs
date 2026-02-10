/**
 * Server entry point
 * 
 * Startup order:
 * 1. Load env vars
 * 2. Connect to MongoDB
 * 3. Set up Express with routes
 * 4. Create HTTP server and attach Socket.IO
 * 5. Connect to Redis
 * 6. Start listening
 * 
 * Express handles HTTP requests, Socket.IO handles websockets.
 * They share the same server but have different middleware.
 */
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { port, clientUrl, nodeEnv } = require('./config/env');
const connectDB = require('./config/db');
const { getClients } = require('./config/redis');
const { initializeSocket } = require('./sockets');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

// Routes
const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');

const app = express();
const server = http.createServer(app);

// Security and parsing middleware
app.use(helmet());
app.use(cors({
  origin: clientUrl,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
if (nodeEnv === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve React build in production
if (nodeEnv === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

// Error handler (has to be last)
app.use(errorHandler);

// Start everything
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Connect to Redis
    await getClients();
    logger.info('Redis clients initialized');

    // Set up websockets
    initializeSocket(server);
    logger.info('WebSocket server initialized');

    // Start listening
    server.listen(port, () => {
      logger.info(`Server running on port ${port} [${nodeEnv}]`);
      logger.info(`API: http://localhost:${port}/api`);
      logger.info(`Health: http://localhost:${port}/api/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

// Catch unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err.message);
  server.close(() => process.exit(1));
});

startServer();
