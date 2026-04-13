const express = require("express");
const dashboardController = require("../controllers/dashboard.controller");

const router = express.Router();

router.get("/langfuse/questions", dashboardController.getLangfuseQuestionsTree);

module.exports = router;
