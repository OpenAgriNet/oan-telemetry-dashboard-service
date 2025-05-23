const express = require('express');
const { 
    getSessions, 
    getSessionById, 
    getSessionsByUserId,
    getTotalSessionsCount,
    fetchSessionsFromDB,
    formatSessionData
} = require('../controllers/sessions.controller');

const router = express.Router();

// Get all sessions with pagination and search
router.get('/sessions', getSessions);

// Get single session details by session ID
router.get('/sessions/:sessionId', getSessionById);

// Get sessions by user ID with pagination
router.get('/users/:userId/sessions', getSessionsByUserId);

// Get total sessions count
router.get('/sessions/count', getTotalSessionsCount);

// Fetch sessions from DB
router.get('/sessions/fetch', fetchSessionsFromDB);

// Format session data
router.get('/sessions/format', formatSessionData);

module.exports = router;