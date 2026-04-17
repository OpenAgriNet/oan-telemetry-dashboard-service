const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');

const router = express.Router();

router.get('/dashboard/user-analytics', dashboardController.getUserLoginAnalytics);

// Route for getting comprehensive dashboard statistics
router.get('/dashboard/stats', dashboardController.getDashboardStats);

// Route for getting user graph
router.get('/dashboard/user-graph', dashboardController.getUserGraph);

// Route for getting call analytics (uses MVs)
router.get('/dashboard/call-analytics', dashboardController.getCallAnalytics);

// Route for getting user engagement analytics (uses MVs)
router.get('/dashboard/engagement-analytics', dashboardController.getUserEngagementAnalytics);

module.exports = router;

