const express = require("express");
const uiEventsController = require("../controllers/uiEvents.controller");
const { requireStateAccess } = require("../utils/stateAccess");

const router = express.Router();

router.use(requireStateAccess);

router.get("/ui-events", uiEventsController.getUiEvents);
router.get("/ui-events/:id", uiEventsController.getUiEventById);

module.exports = router;
