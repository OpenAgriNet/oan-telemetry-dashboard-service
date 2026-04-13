const express = require('express');
const router = express.Router();
const asrController = require('../controllers/asr.controller');
const { requireStateAccess } = require("../utils/stateAccess");

router.use(requireStateAccess);

// Route for getting all ASR records with pagination, search, date filtering, and stats
router.get('/asr', asrController.getAsr);

module.exports = router;
