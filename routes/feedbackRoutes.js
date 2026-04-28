const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedback.controller');
const { requireStateAccess } = require("../utils/stateAccess");

router.use(requireStateAccess);

// Route for getting all feedback
router.get('/feedback', feedbackController.getAllFeedback);

// Route for getting comprehensive feedback statistics
router.get('/feedback/stats', feedbackController.getFeedbackStats);

// Route for getting feedback graph data for time-series visualization
router.get('/feedback/graph', feedbackController.getFeedbackGraph);

// Route for getting distinct channels for filter dropdown
router.get('/feedback/channels', feedbackController.getDistinctChannels);

// Route for getting feedback by QID
router.get('/feedback/id/:id', feedbackController.getFeedbackByid);

// Route for getting feedback by session ID
router.get('/feedback/session/:sessionId', feedbackController.getFeedbackBySessionId);

module.exports = router;
