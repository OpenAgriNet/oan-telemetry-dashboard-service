const {
  ensureExportTable,
  getExportTempDir,
} = require("../services/exportInit");
const fs = require("fs");

/**
 * Ensures export_details table and temp folder exist before any export API runs.
 * Uses CREATE TABLE IF NOT EXISTS — safe to run on every request.
 */
async function ensureExportInfrastructure(req, res, next) {
  try {
    fs.mkdirSync(getExportTempDir(), { recursive: true });
    await ensureExportTable();
    next();
  } catch (error) {
    console.error("[Export] Failed to ensure export infrastructure:", error);
    return res.status(500).json({
      success: false,
      message: "Export service is unavailable",
      error: error.message,
    });
  }
}

module.exports = {
  ensureExportInfrastructure,
};
