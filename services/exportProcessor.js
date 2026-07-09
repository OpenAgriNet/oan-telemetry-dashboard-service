const path = require("path");
const fs = require("fs");
const pool = require("./db");
const { writeExportXlsxToFile } = require("./exportDataFetcher");
const { ensureExportTable, getExportTempDir } = require("./exportInit");
const { buildExportFileName } = require("../utils/displayFormat");

const MAX_CONCURRENT_EXPORTS = parseInt(process.env.EXPORT_MAX_CONCURRENT || "5", 10);
let activeExportCount = 0;
const exportQueue = [];

async function updateExportStatus(exportId, updates) {
  const fields = [];
  const values = [];
  let paramIndex = 1;

  Object.entries(updates).forEach(([key, value]) => {
    fields.push(`${key} = $${paramIndex}`);
    values.push(value);
    paramIndex += 1;
  });

  values.push(exportId);

  await pool.query(
    `UPDATE export_details SET ${fields.join(", ")} WHERE id = $${paramIndex}`,
    values,
  );
}

function resolveUniqueExportFileName(tempDir, fileName) {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  let candidate = fileName;
  let counter = 1;

  while (fs.existsSync(path.join(tempDir, candidate))) {
    candidate = `${baseName}-${counter}${ext}`;
    counter += 1;
  }

  return candidate;
}

async function runExportJob(exportId) {
  activeExportCount += 1;

  try {
    const result = await pool.query(
      "SELECT * FROM export_details WHERE id = $1",
      [exportId],
    );

    if (!result.rows.length) {
      return;
    }

    const exportRecord = result.rows[0];

    if (exportRecord.export_status !== "PROCESSING") {
      return;
    }

    await ensureExportTable();

    // Large exports can run for several minutes.
    await pool.query("SET statement_timeout TO '900000'");

    console.log(`[Export] Processing export ${exportId} (${exportRecord.module_name})`);

    fs.mkdirSync(getExportTempDir(), { recursive: true });
    const tempDir = getExportTempDir();
    const requestedAt = exportRecord.requested_at
      ? new Date(exportRecord.requested_at)
      : new Date();
    const fileName = resolveUniqueExportFileName(
      tempDir,
      buildExportFileName(exportRecord.module_name, requestedAt),
    );
    const filePath = path.join(tempDir, fileName);

    const totalRows = await writeExportXlsxToFile(exportRecord, filePath);
    fs.chmodSync(filePath, 0o644);

    await updateExportStatus(exportId, {
      export_status: "COMPLETED",
      file_name: fileName,
      file_path: filePath,
      completed_at: new Date(),
      error_message: null,
    });

    console.log(`[Export] Completed export ${exportId} (${totalRows} rows)`);
  } catch (error) {
    console.error(`[Export] Failed to process export ${exportId}:`, error);
    await updateExportStatus(exportId, {
      export_status: "FAILED",
      completed_at: new Date(),
      error_message: error.message || "Export generation failed",
    });
  } finally {
    activeExportCount -= 1;
    processNextQueuedExport();
  }
}

function processNextQueuedExport() {
  while (activeExportCount < MAX_CONCURRENT_EXPORTS && exportQueue.length > 0) {
    const nextExportId = exportQueue.shift();
    runExportJob(nextExportId);
  }
}

function enqueueExport(exportId) {
  if (activeExportCount < MAX_CONCURRENT_EXPORTS) {
    console.log(`[Export] Starting export ${exportId} (${activeExportCount + 1}/${MAX_CONCURRENT_EXPORTS} slots in use)`);
    runExportJob(exportId);
    return;
  }

  console.log(`[Export] Queued export ${exportId} (${exportQueue.length + 1} waiting)`);
  exportQueue.push(exportId);
}

function triggerExportProcessing(exportId) {
  setImmediate(() => {
    enqueueExport(exportId);
  });
}

async function recoverPendingExports() {
  try {
    const result = await pool.query(
      `
        SELECT id
        FROM export_details
        WHERE export_status = 'PROCESSING'
        ORDER BY requested_at ASC
        LIMIT 20
      `,
    );

    if (!result.rows.length) {
      return;
    }

    console.log(`[Export] Resuming ${result.rows.length} pending export(s)`);
    for (const row of result.rows) {
      triggerExportProcessing(row.id);
    }
  } catch (error) {
    console.error("[Export] Failed to recover pending exports:", error);
  }
}

module.exports = {
  triggerExportProcessing,
  recoverPendingExports,
};
