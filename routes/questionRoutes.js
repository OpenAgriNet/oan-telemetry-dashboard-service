const requireTelemetryDetail = require("../middleware/requireTelemetryDetail");
const express = require('express');
const { 
    getQuestions,
    getQuestionById,
    getQuestionsByUserId,
    getQuestionsBySessionId,
    getQuestionStats,
    getQuestionsGraph,
    getTotalQuestionsCount,
    fetchQuestionsFromDB,
    formatQuestionData
} = require('../controllers/questions.controller');

const router = express.Router();

// Get all questions with pagination and search
router.get('/questions', getQuestions);

// Get comprehensive question statistics
router.get('/questions/stats', getQuestionStats);

// Get questions graph data for time-series visualization
router.get('/questions/graph', getQuestionsGraph);

// Get questions by user ID with pagination
router.get('/users/:userId/questions', getQuestionsByUserId);

// Get questions by session ID
router.get('/questions/session/:sessionId', requireTelemetryDetail, getQuestionsBySessionId);

// Get total questions count
router.get('/questions/count', getTotalQuestionsCount);

// Fetch questions from DB
router.get('/questions/fetch', fetchQuestionsFromDB);

// Format question data
router.get('/questions/format', formatQuestionData);

router.get('/questions/:id', requireTelemetryDetail, getQuestionById);

module.exports = router;
