
const express = require('express');
const { getSessions } = require('../controllers/sessions.controller');

const router = express.Router();

router.get('/sessions', getSessions);

module.exports = router;
