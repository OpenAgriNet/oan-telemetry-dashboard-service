const { isSuperAdmin } = require("../utils/stateAccess");
const {
  EMAIL_RE,
  getPublicSettings,
  getSmtpProblem,
  saveSettings,
} = require("../services/reportSettings");
const {
  DAILY_REPORTS,
  sendDailyReport,
  getRecentRuns,
  getScheduleInfo,
} = require("../services/dailyReport");

/** Report recipients and on/off switch: super-admin only. */
function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ status: "error", message: "Super admin only" });
  }
  next();
}

async function settingsResponse() {
  const [settings, recentRuns] = await Promise.all([
    getPublicSettings(),
    getRecentRuns(10),
  ]);
  return {
    ...settings,
    schedule: getScheduleInfo(),
    reports: DAILY_REPORTS.map((r) => ({ key: r.key, subject: r.subject })),
    recentRuns,
  };
}

/** GET /v1/settings/daily-report */
const getDailyReportSettingsHandler = async (req, res) => {
  try {
    return res.status(200).json(await settingsResponse());
  } catch (error) {
    console.error("Error fetching daily report settings:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

/** POST /v1/settings/daily-report  body: { enabled, recipients } */
const saveDailyReportSettingsHandler = async (req, res) => {
  try {
    await saveSettings(req.body || {}, req.user?.email || req.user?.preferred_username);
    return res.status(200).json(await settingsResponse());
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ message: error.message });
    }
    console.error("Error saving daily report settings:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

/**
 * POST /v1/settings/daily-report/test  body: { to? }
 * Sends today's report now to one address (default: the caller's email).
 * Doesn't count as the day's scheduled send.
 */
const sendTestDailyReportHandler = async (req, res) => {
  const to = String(req.body?.to || req.user?.email || "").trim();
  if (!EMAIL_RE.test(to)) {
    return res.status(400).json({ message: "Provide a valid email address to send the test to" });
  }
  const smtpProblem = getSmtpProblem();
  if (smtpProblem) {
    return res.status(400).json({ message: smtpProblem, code: "SMTP_NOT_CONFIGURED" });
  }

  try {
    const result = await sendDailyReport(DAILY_REPORTS[0], { to: [to] });
    return res.status(200).json({ status: result.status, to });
  } catch (error) {
    console.error("Error sending test daily report:", error);
    // SMTP errors (auth, connection) are what the admin needs to see here
    return res.status(502).json({ message: `Test email failed: ${error.message}` });
  }
};

module.exports = {
  requireSuperAdmin,
  getDailyReportSettingsHandler,
  saveDailyReportSettingsHandler,
  sendTestDailyReportHandler,
};
