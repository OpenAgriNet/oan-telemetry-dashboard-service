const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');

const router = express.Router();

router.get('/user-analytics', dashboardController.getUserLoginAnalytics);

module.exports = router;

