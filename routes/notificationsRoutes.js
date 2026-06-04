const express = require("express");
const notificationsController = require("../controllers/notifications.controller");
const { requireStateAccess } = require("../utils/stateAccess");

const router = express.Router();

router.use(requireStateAccess);

router.get("/notifications", notificationsController.getNotifications);
router.get("/notifications/summary", notificationsController.getNotificationSummary);
router.get("/notifications/:id", notificationsController.getNotificationById);

module.exports = router;
