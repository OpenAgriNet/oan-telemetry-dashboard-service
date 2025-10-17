const express = require("express");
const router = express.Router();
const leaderboardController = require("../controllers/leaderboard.controller");

// Route for getting top 50 users by location
router.get("/leaderboard/top50", leaderboardController.getTop50ByLocation);

// Route for getting top 50 users by location and farmer ID
router.get(
  "/leaderboard/top50/farmer",
  leaderboardController.getTop50ByLocationAndFarmer
);

module.exports = router;
