const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedback.controller');

// Route for getting all feedback
router.get('/feedback', feedbackController.getAllFeedback);

// Route for getting comprehensive feedback statistics
router.get('/feedback/stats', feedbackController.getFeedbackStats);

// Route for getting feedback graph data for time-series visualization
router.get('/feedback/graph', feedbackController.getFeedbackGraph);

// Route for getting feedback by QID
router.get('/feedback/id/:id', feedbackController.getFeedbackByid);

// Route for getting feedback by session ID
router.get('/feedback/session/:sessionId', feedbackController.getFeedbackBySessionId);

// Route for getting total feedback count
router.get('/feedback/count', feedbackController.getTotalFeedbackCount);

// Route for fetching feedback from DB
router.get('/feedback/fetch', feedbackController.fetchAllFeedbackFromDB);

// Route for formatting feedback data
router.get('/feedback/format', feedbackController.formatFeedbackData);

module.exports = router;    