const express = require("express");
const router = express.Router();
const serviceCheckController = require("../controllers/serviceCheck.controller");
const { requireStateAccess } = require("../utils/stateAccess");

router.use(requireStateAccess);

// Per-service external API health: total / completed / failed per API
// Filters: startDate, endDate, service
router.get("/service-check", serviceCheckController.getServiceCheckHandler);

module.exports = router;
