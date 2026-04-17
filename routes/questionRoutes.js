const express = require('express');
const {
    getQuestions,
    getQuestionById,
    getQuestionsByUserId,
    getQuestionsBySessionId,
    getQuestionStats,
    getQuestionsGraph,
} = require('../controllers/questions.controller');

const router = express.Router();

// Specific routes FIRST so they are not shadowed by /:id.
router.get('/questions', getQuestions);
router.get('/questions/stats', getQuestionStats);
router.get('/questions/graph', getQuestionsGraph);
router.get('/questions/session/:sessionId', getQuestionsBySessionId);

// Parameterised route LAST.
router.get('/questions/:id', getQuestionById);

// Questions for a given user.
router.get('/users/:userId/questions', getQuestionsByUserId);

module.exports = router;
