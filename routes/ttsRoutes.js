const express = require('express');
const router = express.Router();
const ttsController = require('../controllers/tts.controller');
const { requireStateAccess } = require("../utils/stateAccess");

router.use(requireStateAccess);

// Route for getting all TTS records with pagination, search, date filtering, and stats
router.get('/tts', ttsController.getTts);

module.exports = router;
