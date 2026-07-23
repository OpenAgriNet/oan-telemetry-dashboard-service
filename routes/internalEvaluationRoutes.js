const router = require("express").Router();
const controller = require("../controllers/evaluation.controller");

router.get("/feedback-candidates", controller.getFeedbackCandidates);
router.put("/runs/:runId", controller.upsertRun);
router.put("/runs/:runId/manifest", controller.upsertManifest);
router.get("/runs/:runId/manifest", controller.getManifest);
router.post("/runs/:runId/sync", controller.syncRunFromLangfuse);
router.put("/runs/:runId/items/:traceId", controller.upsertItem);
router.patch("/runs/:runId/traces/:traceId", controller.updateTraceStatus);

module.exports = router;
