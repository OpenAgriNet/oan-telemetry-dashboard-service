const fs = require("fs");
const path = require("path");
const pool = require("./db");

const TEMP_EXPORT_DIR = path.join(__dirname, "..", "temp", "exports");

async function ensureExportTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS export_details (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      username TEXT,
      module_name TEXT NOT NULL,
      from_date TIMESTAMPTZ,
      to_date TIMESTAMPTZ,
      export_status TEXT NOT NULL DEFAULT 'PROCESSING',
      file_name TEXT,
      file_path TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      error_message TEXT,
      telemetry_state VARCHAR(50),
      filters JSONB DEFAULT '{}'::jsonb
    )
  `);

  // Safe migrations when table already exists with an older schema.
  await pool.query(`
    ALTER TABLE export_details
    ADD COLUMN IF NOT EXISTS username TEXT
  `);

  await pool.query(`
    ALTER TABLE export_details
    ADD COLUMN IF NOT EXISTS telemetry_state VARCHAR(50)
  `);

  await pool.query(`
    ALTER TABLE export_details
    ADD COLUMN IF NOT EXISTS filters JSONB DEFAULT '{}'::jsonb
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_export_details_user_id
    ON export_details (user_id, requested_at DESC)
  `);
}

function ensureExportTempDir() {
  fs.mkdirSync(TEMP_EXPORT_DIR, { recursive: true });
}

function getExportTempDir() {
  return TEMP_EXPORT_DIR;
}

async function initExportFeature() {
  ensureExportTempDir();
  await ensureExportTable();
}

module.exports = {
  initExportFeature,
  ensureExportTable,
  getExportTempDir,
};
