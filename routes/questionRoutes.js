const express = require('express');
const { getQuestions } = require('../controllers/questions.controller');

const router = express.Router();

router.get('/questions', getQuestions);

module.exports = router;
