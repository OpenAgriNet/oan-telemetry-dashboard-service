/**
 * Telemetry Query Service
 * 
 * Microservice to query processed telemetry data
 */

const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const logger = require('./logger');
const { verifyToken } = require('./middleware/auth-middleware');

// Load environment variables
dotenv.config();

// Create Express application
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ALLOWED_ORIGINS ? process.env.CORS_ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(helmet());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// PostgreSQL connection pool
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'telemetry',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

// Health check endpoint (no authentication required)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'UP',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    auth: process.env.AUTH_ENABLED === 'false' ? 'disabled' : 'enabled'
  });
});

// Apply authentication middleware to all routes except health check
app.use('/api', verifyToken);

// Import route modules
const usersRoutes = require('./routes/users');
const sessionsRoutes = require('./routes/sessions');
const questionsRoutes = require('./routes/questions');
const metricsRoutes = require('./routes/metrics');
const feedbackRoutes = require('./routes/feedback');

// Register route handlers
app.use('/api/users', usersRoutes(pool));
app.use('/api/sessions', sessionsRoutes(pool));
app.use('/api/questions', questionsRoutes(pool));
app.use('/api/metrics', metricsRoutes(pool));
app.use('/api/feedback', feedbackRoutes(pool));

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Error processing request: ${err.message}`);
  logger.error(err.stack);
  
  res.status(err.statusCode || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_ERROR'
    }
  });
});

// Start server
async function startServer() {
  try {
    // Test database connection
    const client = await pool.connect();
    client.release();
    logger.info('Successfully connected to the database');
    
    // Start Express server
    app.listen(PORT, () => {
      logger.info(`Telemetry query service started on port ${PORT}`);
      logger.info(`Authentication ${process.env.AUTH_ENABLED === 'false' ? 'disabled' : 'enabled'}`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  pool.end();
  process.exit(0);
});

// Only start server if this file is run directly (not when required in tests)
if (require.main === module) {
  startServer();
}

module.exports = { app, pool };
