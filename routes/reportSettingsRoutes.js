const express = require("express");
const router = express.Router();
const controller = require("../controllers/reportSettings.controller");

// Daily report recipients + SMTP settings (super-admin only)
router.get(
  "/settings/daily-report",
  controller.requireSuperAdmin,
  controller.getDailyReportSettingsHandler,
);
router.post(
  "/settings/daily-report",
  controller.requireSuperAdmin,
  controller.saveDailyReportSettingsHandler,
);
router.post(
  "/settings/daily-report/test",
  controller.requireSuperAdmin,
  controller.sendTestDailyReportHandler,
);

module.exports = router;
