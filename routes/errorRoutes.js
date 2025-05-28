const express = require('express');
const router = express.Router();
const errorController = require('../controllers/error.controller');

// Route for getting all errors with pagination
router.get('/errors', errorController.getAllErrors);

// Route for getting comprehensive error statistics
router.get('/errors/stats', errorController.getErrorStatistics);

// Route for getting error graph data for time-series visualization
router.get('/errors/graph', errorController.getErrorGraph);

// Route for getting error by ID
router.get('/errors/id/:id', errorController.getErrorById);

// Route for getting errors by session ID
router.get('/errors/session/:sessionId', errorController.getErrorsBySessionId);

module.exports = router; 