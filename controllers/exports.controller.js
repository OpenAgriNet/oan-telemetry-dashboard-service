const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const pool = require("../services/db");
const { triggerExportProcessing } = require("../services/exportProcessor");
const {
  isSuperAdmin,
  getRequestedStateId,
  getAllowedStateIds,
  STATE_CONFIG,
} = require("../utils/stateAccess");
const { getUserDisplayName, getUserId: getAuthUserId } = require("../utils/userIdentity");

const VALID_MODULES = new Set([
  "questions",
  "feedback",
  "notifications",
  "asr",
  "tts",
  "call-logs",
]);

const STATE_REQUIRED_MODULES = new Set([
  "questions",
  "feedback",
  "notifications",
  "asr",
  "tts",
]);

function getUserId(req) {
  return getAuthUserId(req.user);
}

function getUsername(req) {
  return getUserDisplayName(req.user);
}

function formatExportRow(row) {
  const stateId = row.telemetry_state;
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    exportedBy: row.username || row.user_id || null,
    moduleName: row.module_name,
    fromDate: row.from_date,
    toDate: row.to_date,
    exportStatus: row.export_status,
    fileName: row.file_name,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    telemetryState: stateId,
    telemetryStateLabel: stateId
      ? (STATE_CONFIG[stateId]?.label || stateId)
      : "All",
    filters: row.filters || {},
    publicDownloadUrl: `/v1/exports/${row.id}/download/public`,
  };
}

function getExportFilePath(exportRecord) {
  if (!exportRecord.file_path || !exportRecord.file_name) {
    return null;
  }

  const resolvedPath = path.resolve(exportRecord.file_path);
  const tempDir = path.resolve(require("../services/exportInit").getExportTempDir());

  if (!resolvedPath.startsWith(tempDir) || !fs.existsSync(resolvedPath)) {
    return null;
  }

  return resolvedPath;
}

function sendExportCsvFile(res, exportRecord) {
  const filePath = getExportFilePath(exportRecord);
  if (!filePath) {
    return res.status(404).json({ success: false, message: "Export file not found" });
  }

  const safeFileName = String(exportRecord.file_name || "export.xlsx").replaceAll('"', "");
  const isXlsx = safeFileName.toLowerCase().endsWith(".xlsx");
  const contentType = isXlsx
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv; charset=utf-8";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`,
  );

  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Failed to read export file" });
    }
  });
  stream.pipe(res);
  return null;
}

function validateExportForDownload(exportRecord, res) {
  if (exportRecord.export_status === "PROCESSING") {
    res.status(409).json({
      success: false,
      message: "Export is still processing",
    });
    return false;
  }

  if (exportRecord.export_status === "FAILED") {
    res.status(409).json({
      success: false,
      message: exportRecord.error_message || "Export generation failed",
    });
    return false;
  }

  return true;
}

function validateModuleAccess(req, moduleName) {
  if (!VALID_MODULES.has(moduleName)) {
    return { ok: false, status: 400, message: "Invalid module name" };
  }

  if (moduleName === "call-logs") {
    if (!isSuperAdmin(req.user)) {
      return { ok: false, status: 403, message: "Forbidden for call logs export" };
    }
    return { ok: true, telemetryStateId: null };
  }

  const requestedStateId = getRequestedStateId(req);
  if (!requestedStateId) {
    return { ok: false, status: 400, message: "State is required" };
  }

  const allowedStateIds = getAllowedStateIds(req.user);
  if (!allowedStateIds.includes(requestedStateId)) {
    return { ok: false, status: 403, message: "Forbidden for requested state" };
  }

  if (!STATE_REQUIRED_MODULES.has(moduleName)) {
    return { ok: false, status: 400, message: "Invalid module name" };
  }

  return { ok: true, telemetryStateId: requestedStateId };
}

async function createExport(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const moduleName = String(req.body.moduleName || "").trim();
    const fromDate = req.body.fromDate ? String(req.body.fromDate).trim() : null;
    const toDate = req.body.toDate ? String(req.body.toDate).trim() : null;
    const filters = req.body.filters && typeof req.body.filters === "object"
      ? req.body.filters
      : {};

    const access = validateModuleAccess(req, moduleName);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const exportId = randomUUID();

    const result = await pool.query(
      `
        INSERT INTO export_details (
          id,
          user_id,
          username,
          module_name,
          from_date,
          to_date,
          export_status,
          telemetry_state,
          filters
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'PROCESSING', $7, $8)
        RETURNING *
      `,
      [
        exportId,
        userId,
        getUsername(req),
        moduleName,
        fromDate,
        toDate,
        access.telemetryStateId,
        filters,
      ],
    );

    const exportRecord = result.rows[0];
    triggerExportProcessing(exportRecord.id);

    return res.status(202).json({
      success: true,
      message: "CSV export has been initiated successfully",
      data: formatExportRow(exportRecord),
    });
  } catch (error) {
    console.error("Error creating export:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to initiate export",
      error: error.message,
    });
  }
}

async function listExports(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const requestedStateId = getRequestedStateId(req);
    const params = [userId];
    let query = `
      SELECT *
      FROM export_details
      WHERE user_id = $1
    `;

    if (requestedStateId) {
      query += ` AND telemetry_state = $2`;
      params.push(requestedStateId);
    }

    query += ` ORDER BY requested_at DESC LIMIT 200`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map(formatExportRow),
    });
  } catch (error) {
    console.error("Error listing exports:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch exports",
      error: error.message,
    });
  }
}

async function downloadExport(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const exportId = String(req.params.id || "").trim();
    if (!exportId) {
      return res.status(400).json({ success: false, message: "Invalid export ID" });
    }

    const result = await pool.query(
      "SELECT * FROM export_details WHERE id = $1 AND user_id = $2",
      [exportId, userId],
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Export not found" });
    }

    const exportRecord = result.rows[0];
    if (!validateExportForDownload(exportRecord, res)) {
      return;
    }

    return sendExportCsvFile(res, exportRecord);
  } catch (error) {
    console.error("Error downloading export:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to download export",
      error: error.message,
    });
  }
}

async function downloadExportPublic(req, res) {
  try {
    const exportId = String(req.params.id || "").trim();
    if (!exportId) {
      return res.status(400).json({ success: false, message: "Invalid export ID" });
    }

    const result = await pool.query(
      "SELECT * FROM export_details WHERE id = $1",
      [exportId],
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: "Export not found" });
    }

    const exportRecord = result.rows[0];
    if (!validateExportForDownload(exportRecord, res)) {
      return;
    }

    return sendExportCsvFile(res, exportRecord);
  } catch (error) {
    console.error("Error downloading public export:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to download export",
      error: error.message,
    });
  }
}

module.exports = {
  createExport,
  listExports,
  downloadExport,
  downloadExportPublic,
  VALID_MODULES,
};
