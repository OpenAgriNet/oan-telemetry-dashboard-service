const express = require('express');
const { 
    getQuestions, 
    getQuestionById, 
    getQuestionsByUserId,
    getQuestionsBySessionId,
    getQuestionStats,
    getQuestionsGraph,
    getTotalQuestionsCountHandler,
    fetchQuestionsFromDBHandler,
    formatQuestionDataHandler
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
router.get('/questions/session/:sessionId', getQuestionsBySessionId);

// Get total questions count
router.get('/questions/count', getTotalQuestionsCountHandler);

// Fetch questions from DB
router.get('/questions/fetch', fetchQuestionsFromDBHandler);

// Format question data
router.get('/questions/format', formatQuestionDataHandler);

// Get single question by ID
router.get('/questions/:id', getQuestionById);

module.exports = router;