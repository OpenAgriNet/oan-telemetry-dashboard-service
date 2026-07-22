const router = require("express").Router();
const controller = require("../controllers/evaluation.controller");

router.get("/evaluations/runs", controller.listRuns);
router.get("/evaluations/runs/:runId/summary", controller.getSummary);
router.post("/evaluations/runs/:runId/sync", controller.syncRunFromLangfuse);
router.get("/evaluations/runs/:runId/items", controller.listItems);
router.get("/evaluations/runs/:runId/items/:itemId", controller.getItem);
router.post("/evaluations/runs/:runId/items/:itemId/comments", controller.addComment);

module.exports = router;
