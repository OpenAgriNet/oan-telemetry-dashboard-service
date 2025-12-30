const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');

const router = express.Router();

router.get('/dashboard/user-analytics', dashboardController.getUserLoginAnalytics);

// Route for getting comprehensive dashboard statistics
router.get('/dashboard/stats', dashboardController.getDashboardStats);

// Route for getting user graph
router.get('/dashboard/user-graph', dashboardController.getUserGraph);

module.exports = router;

