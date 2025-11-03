const express = require("express");
const router = express.Router();
const leaderboardController = require("../controllers/leaderboard.controller");

// Route for getting top 10 users by state, taluka, and district
router.get("/top10/state", leaderboardController.getTop10ByState);
router.get("/top10/taluka", leaderboardController.getTop10ByTaluka);
router.get("/top10/district", leaderboardController.getTop10ByDistrict);

module.exports = router;
