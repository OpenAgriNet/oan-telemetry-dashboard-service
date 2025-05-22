const express = require('express');
const { 
    getUsers, 
    getUserByUsername,
    getUserStats 
} = require('../controllers/user.controller');

const router = express.Router();

// Get all users with pagination and search
router.get('/users', getUsers);

// Get user statistics and activity summary
router.get('/users/stats', getUserStats);

// Get single user details by username
router.get('/users/:username', getUserByUsername);

module.exports = router;