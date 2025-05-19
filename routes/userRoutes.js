const express = require('express');
const { getUsers } = require('../controllers/users.contoller');

const router = express.Router();

router.get('/users', getUsers);

module.exports = router;


