const express = require('express');
const { 
    getQuestions, 
    getQuestionById, 
    getQuestionsByUserId,
    getTotalQuestionsCount,
    fetchQuestionsFromDB,
    formatQuestionData,
    getQuestionsBySessionId
} = require('../controllers/questions.controller');

const router = express.Router();

// Get all questions with pagination and search
router.get('/questions', getQuestions);

// Get single question by ID
router.get('/questions/:id', getQuestionById);

// Get questions by user ID with pagination
router.get('/users/:userId/questions', getQuestionsByUserId);

// Get total questions count
router.get('/questions/count', getTotalQuestionsCount);

// Fetch questions from DB
router.get('/questions/fetch', fetchQuestionsFromDB);

// Format question data
router.get('/questions/format', formatQuestionData);

// Get questions by session ID
router.get('/questions/session/:sessionId', getQuestionsBySessionId);

module.exports = router;