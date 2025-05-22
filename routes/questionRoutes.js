const express = require('express');
const { 
    getQuestions, 
    getQuestionById, 
    getQuestionsByUserId 
} = require('../controllers/questions.controller');

const router = express.Router();

// Get all questions with pagination and search
router.get('/questions', getQuestions);

// Get single question by ID
router.get('/questions/:id', getQuestionById);

// Get questions by user ID with pagination
router.get('/users/:userId/questions', getQuestionsByUserId);

module.exports = router;