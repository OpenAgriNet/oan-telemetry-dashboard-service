const router = require("express").Router();
const controller = require("../controllers/evaluation.controller");
const adminController = require("../controllers/evaluationAdmin.controller");
const requireSuperAdmin = require("../middleware/requireSuperAdmin");

router.get("/evaluations/judge-models", requireSuperAdmin, controller.listJudgeModels);
router.get("/evaluations/judge-endpoints", requireSuperAdmin, adminController.listEndpoints);
router.post("/evaluations/judge-endpoints", requireSuperAdmin, adminController.createEndpoint);
router.patch("/evaluations/judge-endpoints/:endpointId", requireSuperAdmin, adminController.updateEndpoint);
router.delete("/evaluations/judge-endpoints/:endpointId", requireSuperAdmin, adminController.disableEndpoint);
router.post("/evaluations/judge-endpoints/:endpointId/test", requireSuperAdmin, adminController.testEndpoint);
router.get("/evaluations/schedules", requireSuperAdmin, adminController.listSchedules);
router.post("/evaluations/schedules", requireSuperAdmin, adminController.createSchedule);
router.patch("/evaluations/schedules/:scheduleId", requireSuperAdmin, adminController.updateSchedule);
router.delete("/evaluations/schedules/:scheduleId", requireSuperAdmin, adminController.deleteSchedule);
router.post("/evaluations/runs", requireSuperAdmin, controller.startRun);
router.get("/evaluations/runs", controller.listRuns);
router.get("/evaluations/runs/:runId/summary", controller.getSummary);
router.post("/evaluations/runs/:runId/sync", requireSuperAdmin, controller.syncRunFromLangfuse);
router.get("/evaluations/runs/:runId/items", controller.listItems);
router.get("/evaluations/runs/:runId/items/:itemId", controller.getItem);
router.post("/evaluations/runs/:runId/items/:itemId/comments", controller.addComment);

module.exports = router;
