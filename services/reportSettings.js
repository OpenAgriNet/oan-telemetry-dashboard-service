const pool = require("./db");

/**
 * Daily report settings edited from the dashboard Settings page, stored in
 * report_settings: the on/off switch (default off) and recipients
 * (falls back to DAILY_REPORT_RECIPIENTS when empty).
 *
 * SMTP comes from env only:
 *   SMTP_ENABLED           "true" to allow sending from this server
 *   SMTP_HOST              host or host:port (default smtp.gmail.com:587)
 *   SMTP_USER              login, e.g. the Gmail address
 *   SMTP_PASSWORD          Gmail app password
 *   SMTP_FROM_ADDRESS      default SMTP_USER
 *   SMTP_FROM_NAME         optional display name
 *   SMTP_STARTTLS_POLICY   OpportunisticStartTLS (default) | MandatoryStartTLS | NoStartTLS
 *   SMTP_SKIP_VERIFY       "true" skips TLS certificate verification
 */
const SETTINGS_KEY = "daily-report";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function ensureReportSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
}

async function getStoredSettings() {
  await ensureReportSettingsTable();
  const { rows } = await pool.query(
    "SELECT value, updated_at, updated_by FROM report_settings WHERE key = $1",
    [SETTINGS_KEY],
  );
  return rows[0] || { value: {}, updated_at: null, updated_by: null };
}

function envRecipients() {
  return String(process.env.DAILY_REPORT_RECIPIENTS || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/** Why email can't be sent from this server, or null when it can. */
function getSmtpProblem(smtp = getSmtpConfig()) {
  if (!smtp.enabled) return "SMTP is not enabled on this server (SMTP_ENABLED is not true)";
  if (!smtp.configured) {
    return "SMTP is enabled but not fully configured on this server (SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required)";
  }
  return null;
}

function isTrue(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function getSmtpConfig() {
  const [host, portPart] = String(process.env.SMTP_HOST || "smtp.gmail.com:587")
    .trim()
    .split(":");
  const parsedPort = parseInt(portPart, 10);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 587;
  const user = process.env.SMTP_USER || "";
  const fromAddress = process.env.SMTP_FROM_ADDRESS || user;
  const fromName = (process.env.SMTP_FROM_NAME || "").trim();
  const enabled = isTrue(process.env.SMTP_ENABLED);

  return {
    enabled,
    configured: enabled && Boolean(host && user && process.env.SMTP_PASSWORD),
    host,
    port,
    user,
    pass: process.env.SMTP_PASSWORD || "",
    from: fromName ? `"${fromName.replace(/"/g, "")}" <${fromAddress}>` : fromAddress,
    startTlsPolicy: process.env.SMTP_STARTTLS_POLICY || "OpportunisticStartTLS",
    skipVerify: isTrue(process.env.SMTP_SKIP_VERIFY),
  };
}

/** Settings used to send the report. */
async function getEffectiveReportConfig() {
  const { value } = await getStoredSettings();
  const recipients =
    Array.isArray(value.recipients) && value.recipients.length > 0
      ? value.recipients
      : envRecipients();

  return {
    enabled: value.enabled === true,
    recipients,
    smtp: getSmtpConfig(),
  };
}

/** Client view. SMTP is read-only: where mail comes from, never credentials. */
async function getPublicSettings() {
  const stored = await getStoredSettings();
  const value = stored.value || {};
  const smtp = getSmtpConfig();

  return {
    enabled: value.enabled === true,
    recipients: Array.isArray(value.recipients) ? value.recipients : [],
    envRecipients: envRecipients(),
    smtp: {
      enabled: smtp.enabled,
      configured: smtp.configured,
      problem: getSmtpProblem(smtp),
      host: `${smtp.host}:${smtp.port}`,
      from: smtp.from,
    },
    updatedAt: stored.updated_at,
    updatedBy: stored.updated_by,
  };
}

/** Save the on/off switch and recipients from the UI. */
async function saveSettings(input, updatedBy) {
  const recipients = Array.isArray(input.recipients)
    ? [...new Set(input.recipients.map((e) => String(e).trim().toLowerCase()).filter(Boolean))]
    : [];
  const invalid = recipients.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length > 0) {
    const error = new Error(`Invalid recipient email: ${invalid.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const value = { enabled: input.enabled === true, recipients };

  await ensureReportSettingsTable();
  await pool.query(
    `
    INSERT INTO report_settings (key, value, updated_at, updated_by)
    VALUES ($1, $2::jsonb, NOW(), $3)
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by
    `,
    [SETTINGS_KEY, JSON.stringify(value), updatedBy || null],
  );

  return getPublicSettings();
}

module.exports = {
  EMAIL_RE,
  getSmtpConfig,
  getSmtpProblem,
  getEffectiveReportConfig,
  getPublicSettings,
  saveSettings,
};
