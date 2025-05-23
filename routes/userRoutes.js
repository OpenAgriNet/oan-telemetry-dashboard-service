const express = require('express');
const { 
    getUsers, 
    getUserByUsername,
    getUserStats,
    getTotalUsersCount,
    fetchUsersFromDB,
    formatUserData
} = require('../controllers/user.controller');

const router = express.Router();

// Get all users with pagination and search
router.get('/users', getUsers);

// Get user statistics and activity summary
router.get('/users/stats', getUserStats);

// Get single user details by username
router.get('/users/:username', getUserByUsername);

// Get total users count
router.get('/users/count', getTotalUsersCount);

// Fetch users from DB
router.get('/users/fetch', fetchUsersFromDB);

// Format user data
router.get('/users/format', formatUserData);

module.exports = router;