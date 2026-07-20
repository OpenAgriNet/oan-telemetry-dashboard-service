const express = require("express");
const {
  createExport,
  listExports,
  downloadExport,
} = require("../controllers/exports.controller");
const { ensureExportInfrastructure } = require("../middleware/ensureExportInfrastructure");

const router = express.Router();

router.use(ensureExportInfrastructure);

router.post("/exports", createExport);
router.get("/exports", listExports);
router.get("/exports/:id/download", downloadExport);

module.exports = router;
