const express = require('express');
const {
    getSessions,
    getSessionById,
    getSessionsByUserId,
    getSessionStats,
    getSessionsGraph,
} = require('../controllers/sessions.controller');

const router = express.Router();

// Specific routes FIRST so they are not shadowed by /:sessionId.
router.get('/sessions', getSessions);
router.get('/sessions/stats', getSessionStats);
router.get('/sessions/graph', getSessionsGraph);

// Parameterised route LAST.
router.get('/sessions/:sessionId', getSessionById);

// Sessions for a given user.
router.get('/users/:userId/sessions', getSessionsByUserId);

module.exports = router;
