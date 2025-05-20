const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedback.controller');

// Route for getting all feedback
router.get('/feedback', feedbackController.getAllFeedback);

// Route for getting feedback by QID
router.get('/feedback/id/:id', feedbackController.getFeedbackByid);

module.exports = router;    