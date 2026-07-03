const express = require("express");
const {
  getProviderTelemetry,
  getProviderTelemetryFlow,
} = require("../controllers/providerTelemetry.controller");
const { requireStateAccess } = require("../utils/stateAccess");

const router = express.Router();
router.use(requireStateAccess);

router.get("/provider-telemetry", getProviderTelemetry);
router.get("/provider-telemetry/flow/:questionId", getProviderTelemetryFlow);

module.exports = router;
