const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const { requireStateAccess } = require("../utils/stateAccess");

const router = express.Router();
router.use(requireStateAccess);

router.get('/dashboard/user-analytics', dashboardController.getUserLoginAnalytics);

// Route for getting state-specific dashboard statistics (Chat Metrics)
router.get('/dashboard/stats', dashboardController.getDashboardStats);

// Route for getting unified dashboard statistics (always Bharat Vistaar)
router.get('/dashboard/stats-unified', dashboardController.getDashboardStatsUnified);

// Route for getting user graph
router.get('/dashboard/user-graph', dashboardController.getUserGraph);

module.exports = router;
