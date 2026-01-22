const express = require("express");
const router = express.Router();
const leaderboardController = require("../controllers/leaderboard.controller");

// Route for getting top 10 users by state, taluka, and district
router.get("/top10/state", leaderboardController.getTop10ByState);
router.get("/top10/district", leaderboardController.getTop10ByDistrict);
router.get("/top10/taluka", leaderboardController.getTop10ByTaluka);

// Route for getting top 10 users by lgd_code for the month
router.get("/top10/month", leaderboardController.getTop10Month);

// Route for getting users by taluka, district and village
router.get("/district", leaderboardController.getUsersByDistrict);
router.get("/taluka", leaderboardController.getUsersByTaluka);
router.get("/village", leaderboardController.getUsersByVillage);

// Route for getting active farmers by taluka within a date range
router.get("/reports/active-farmers", leaderboardController.getActiveFarmersByTaluka);

module.exports = router;
