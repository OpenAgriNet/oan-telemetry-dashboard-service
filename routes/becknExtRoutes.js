const express = require("express");
const router = express.Router();
const becknExtController = require("../controllers/becknExt.controller");
const { requireStateAccess } = require("../utils/stateAccess");

router.use(requireStateAccess);

// Stats cards: Total External API Calls, Total Success, Total Errors, Max Latency
// Filters: startDate, endDate, useCase (service_name)
router.get("/beckn-ext/stats", becknExtController.getBecknExtStatsHandler);

// Full lifecycle detail (must be before generic /beckn-ext if any param routes collide)
// GET /beckn-ext/lifecycle/:questionId?sessionId=
router.get(
  "/beckn-ext/lifecycle/:questionId",
  becknExtController.getBecknExtLifecycleHandler,
);

// Paginated table for beckn_ext_events
// Filters: startDate, endDate, useCase, search, page, limit, sortBy, sortOrder, includePayloads
router.get("/beckn-ext", becknExtController.getBecknExtListHandler);

module.exports = router;
