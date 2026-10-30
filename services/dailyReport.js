const nodemailer = require("nodemailer");
const pool = require("./db");
const { STATE_CONFIG } = require("../utils/stateAccess");
const {
  SERVICE_CHECKS,
  findServiceForApi,
  getApiLabel,
} = require("../utils/serviceCheckConfig");
const { getExtApiCallStats } = require("../controllers/becknExt.controller");
const {
  getToolCallsByService,
} = require("../controllers/serviceCheck.controller");
const {
  getEffectiveReportConfig,
  getSmtpConfig,
  getSmtpProblem,
} = require("./reportSettings");

/**
 * Daily health report emails, built from ext_api_calls (same numbers as the
 * Service Check page). Covers the 24 hours before the run.
 *
 * The on/off switch and recipients come from the dashboard Settings page
 * (the switch defaults to off). SMTP_* env (see services/reportSettings.js)
 * configures sending; SMTP_ENABLED must be "true" or nothing is sent from
 * this server.
 *
 * Env:
 *   DAILY_REPORT_CRON        cron expression in IST (default "0 21 * * *")
 *   DAILY_REPORT_RECIPIENTS  used when no recipients are saved in Settings
 *
 * To add a report, add an entry to DAILY_REPORTS. Its rows are every API of
 * the service in utils/serviceCheckConfig.js (same as the Service Check page)
 * plus any other api_service seen for that service; rowLabels renames rows.
 */
const DAILY_REPORTS = [
  {
    key: "pmkisan-daily-health",
    serviceId: "pmkisan",
    stateId: "bharat-vistaar",
    subject: "PM KISAN status check daily health check",
    title: "PM KISAN status check — daily health check",
    rowLabels: {
      pmkisan_send_otp: "PM KISAN OTP SEND",
      pmkisan_verify_otp: "OTP VALIDATE",
      pmkisan_beneficiary_status: "STATUS CHECK",
    },
  },
];

const REPORT_TIMEZONE = "Asia/Kolkata";
const DAY_MS = 24 * 60 * 60 * 1000;

function formatIST(ms, options) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: REPORT_TIMEZONE,
    ...options,
  }).format(new Date(ms));
}

function formatReportDate(ms) {
  return formatIST(ms, { day: "2-digit", month: "short", year: "numeric" });
}

function formatReportDateTime(ms) {
  return formatIST(ms, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** YYYY-MM-DD of the window end in IST; one report per key per day. */
function reportDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE }).format(
    new Date(ms),
  );
}

async function buildReportData(report, endMs = Date.now()) {
  const startMs = endMs - DAY_MS;
  const telemetryState = STATE_CONFIG[report.stateId];
  const range = {
    startDate: String(startMs),
    endDate: String(endMs),
    telemetryState,
  };

  const [stats, toolCalls] = await Promise.all([
    getExtApiCallStats(range),
    getToolCallsByService(range),
  ]);

  const service =
    SERVICE_CHECKS.find((s) => s.id === report.serviceId) ||
    findServiceForApi(`${report.serviceId}_`);
  // Configured APIs in their order, then any other API seen for the service
  const apiServices = [
    ...Object.keys(service.apis),
    ...stats.apis
      .map((a) => a.apiService)
      .filter(
        (a) =>
          a && findServiceForApi(a).id === report.serviceId && !(a in service.apis),
      )
      .sort(),
  ];

  const rows = apiServices.map((apiService) => {
    const label = (
      report.rowLabels?.[apiService] || getApiLabel(service, apiService)
    ).toUpperCase();
    const api = stats.apis.find((a) => a.apiService === apiService) || {};
    const requests = api.total || 0;
    const completed = api.success || 0;
    return {
      apiService,
      label,
      requests,
      completed,
      rejected: api.rejected || 0,
      error: api.error || 0,
      failed: (api.rejected || 0) + (api.error || 0),
      successRate: requests > 0 ? (completed / requests) * 100 : null,
      avgLatencyMs: api.avgLatencyMs || 0,
    };
  });

  const sum = (key) => rows.reduce((acc, r) => acc + r[key], 0);
  const requests = sum("requests");
  const timedRequests = rows
    .filter((r) => r.avgLatencyMs > 0)
    .reduce((acc, r) => acc + r.requests, 0);
  const total = {
    label: "Total",
    requests,
    completed: sum("completed"),
    rejected: sum("rejected"),
    error: sum("error"),
    failed: sum("failed"),
    successRate: requests > 0 ? (sum("completed") / requests) * 100 : null,
    // Request-weighted average across the rows above
    avgLatencyMs:
      timedRequests > 0
        ? Math.round(
            rows.reduce((acc, r) => acc + r.avgLatencyMs * r.requests, 0) /
              timedRequests,
          )
        : 0,
  };

  return {
    report,
    startMs,
    endMs,
    toolCalls: toolCalls[report.serviceId] || 0,
    rows,
    total,
  };
}

function formatPercent(rate) {
  return rate === null ? "—" : `${rate.toFixed(1)}%`;
}

function formatLatency(ms) {
  if (!ms) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

function rateColor(rate) {
  if (rate === null) return "#6b7280";
  if (rate >= 95) return "#047857";
  if (rate >= 80) return "#b45309";
  return "#b91c1c";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Email-safe HTML: tables + inline styles only (clients strip <style>). */
function renderHtml(data) {
  const { report, startMs, endMs, toolCalls, rows, total } = data;
  const cell =
    "padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;";
  const num = `${cell}text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;`;
  const head =
    "padding:10px 12px;background:#f3f4f6;border-bottom:2px solid #d1d5db;font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.04em;";

  const renderRow = (r, isTotal = false) => {
    const weight = isTotal ? "font-weight:700;background:#f9fafb;" : "";
    return `
      <tr>
        <td style="${cell}${weight}">${escapeHtml(r.label)}</td>
        <td style="${num}${weight}">${r.requests.toLocaleString("en-IN")}</td>
        <td style="${num}${weight}color:${rateColor(r.successRate)};font-weight:700;">${formatPercent(r.successRate)}</td>
        <td style="${num}${weight}">${formatLatency(r.avgLatencyMs)}</td>
        <td style="${num}${weight}">
          ${r.failed.toLocaleString("en-IN")}
          <div style="font-size:11px;font-weight:400;color:#6b7280;">${r.rejected} rejected · ${r.error} error</div>
        </td>
      </tr>`;
  };

  return `<!doctype html>
<html>
  <body style="margin:0;padding:12px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:760px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr>
        <td style="padding:20px;background:#14532d;color:#ffffff;">
          <div style="font-size:18px;font-weight:700;">${escapeHtml(report.title)}</div>
          <div style="font-size:13px;opacity:0.85;margin-top:4px;">Date: ${formatReportDate(endMs)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 20px 8px;">
          <div style="font-size:13px;color:#6b7280;">Period: ${formatReportDateTime(startMs)} – ${formatReportDateTime(endMs)} IST</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid #e5e7eb;border-radius:6px;">
            <tr>
              <td style="padding:12px 18px;">
                <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Number of tool calls</div>
                <div style="font-size:28px;font-weight:700;color:#111827;margin-top:2px;">${toolCalls.toLocaleString("en-IN")}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 20px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;">
            <tr>
              <th align="left" style="${head}">API</th>
              <th align="right" style="${head}">Requests</th>
              <th align="right" style="${head}">Success %</th>
              <th align="right" style="${head}">Avg latency</th>
              <th align="right" style="${head}">Failed</th>
            </tr>
            ${rows.map((r) => renderRow(r)).join("")}
            ${renderRow(total, true)}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 20px 20px;font-size:12px;line-height:1.5;color:#6b7280;">
          Tool calls = user requests to the PM KISAN tool (one request can make several API calls).<br>
          Success % = completed ÷ requests. Rejected = PM KISAN answered but refused (e.g. wrong OTP); error = timeout, network or HTTP failure.<br>
          Sent automatically by the Vistaar telemetry dashboard.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(data) {
  const { report, startMs, endMs, toolCalls, rows, total } = data;
  const width = Math.max(...[...rows, total].map((r) => r.label.length), 3) + 2;
  const line = (r) =>
    `${r.label.padEnd(width)} ${String(r.requests).padStart(8)} ${formatPercent(r.successRate).padStart(10)} ${formatLatency(r.avgLatencyMs).padStart(12)}   (${r.rejected} rejected, ${r.error} error)`;

  return [
    report.title,
    `Date: ${formatReportDate(endMs)}`,
    `Period: ${formatReportDateTime(startMs)} – ${formatReportDateTime(endMs)} IST`,
    "",
    `Number of tool calls: ${toolCalls}`,
    "",
    `${"API".padEnd(width)} ${"Requests".padStart(8)} ${"Success %".padStart(10)} ${"Avg latency".padStart(12)}`,
    ...rows.map(line),
    line(total),
    "",
    "Success % = completed / requests. Rejected = PM KISAN refused (e.g. wrong OTP); error = timeout, network or HTTP failure.",
  ].join("\n");
}

async function ensureReportRunsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_report_runs (
      id BIGSERIAL PRIMARY KEY,
      report_key TEXT NOT NULL,
      report_date DATE NOT NULL,
      status TEXT NOT NULL,
      recipients TEXT,
      summary JSONB,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      UNIQUE (report_key, report_date)
    )
  `);
}

/**
 * Claim today's run so only one container/restart sends it.
 * A failed run can be claimed again; a sent or in-progress one can't.
 */
async function claimRun(reportKey, reportDate) {
  const { rows } = await pool.query(
    `
    INSERT INTO daily_report_runs (report_key, report_date, status)
    VALUES ($1, $2, 'sending')
    ON CONFLICT (report_key, report_date) DO UPDATE
      SET status = 'sending', error_message = NULL, created_at = NOW()
      WHERE daily_report_runs.status = 'failed'
    RETURNING id
    `,
    [reportKey, reportDate],
  );
  return rows[0]?.id ?? null;
}

async function finishRun(id, { status, recipients, summary, error }) {
  await pool.query(
    `
    UPDATE daily_report_runs
    SET status = $2,
        recipients = $3,
        summary = $4::jsonb,
        error_message = $5,
        sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
    WHERE id = $1
    `,
    [id, status, recipients, JSON.stringify(summary), error || null],
  );
}

function createTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // 465 is implicit TLS; other ports upgrade with STARTTLS per the policy
    secure: smtp.port === 465,
    requireTLS: smtp.startTlsPolicy === "MandatoryStartTLS",
    ignoreTLS: smtp.startTlsPolicy === "NoStartTLS",
    tls: smtp.skipVerify ? { rejectUnauthorized: false } : undefined,
    auth: { user: smtp.user, pass: smtp.pass },
  });
}

/**
 * Build and send one report.
 *   to        override recipients (manual sends; skips the once-a-day guard)
 *   dryRun    build only, don't send
 *   force     send even if today's scheduled report was already sent
 *   transport nodemailer transport (tests)
 */
async function sendDailyReport(
  report = DAILY_REPORTS[0],
  { to = null, dryRun = false, force = false, now = Date.now(), transport = null } = {},
) {
  const data = await buildReportData(report, now);
  const message = {
    subject: report.subject,
    html: renderHtml(data),
    text: renderText(data),
  };

  if (dryRun) {
    return { status: "dry-run", data, message };
  }

  const config = await getEffectiveReportConfig();
  const recipients = to && to.length ? to : config.recipients;
  if (recipients.length === 0) {
    throw new Error("No recipients: add them in Settings, set DAILY_REPORT_RECIPIENTS or pass --to");
  }
  const smtpProblem = transport ? null : getSmtpProblem(config.smtp);
  if (smtpProblem) {
    const error = new Error(smtpProblem);
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }

  const scheduled = !(to && to.length);
  let runId = null;
  if (scheduled && !force) {
    await ensureReportRunsTable();
    runId = await claimRun(report.key, reportDateKey(now));
    if (!runId) {
      return { status: "skipped", reason: "already sent today", data };
    }
  }

  const summary = {
    startMs: data.startMs,
    endMs: data.endMs,
    toolCalls: data.toolCalls,
    rows: data.rows,
    total: data.total,
  };

  try {
    await (transport || createTransport(config.smtp)).sendMail({
      from: config.smtp.from,
      to: recipients.join(", "),
      ...message,
    });
    if (runId) {
      await finishRun(runId, {
        status: "sent",
        recipients: recipients.join(", "),
        summary,
      });
    }
    return { status: "sent", recipients, data, message };
  } catch (error) {
    if (runId) {
      await finishRun(runId, {
        status: "failed",
        recipients: recipients.join(", "),
        summary,
        error: error.message,
      });
    }
    throw error;
  }
}

async function getRecentRuns(limit = 10) {
  await ensureReportRunsTable();
  const { rows } = await pool.query(
    `
    SELECT report_key, report_date::text AS report_date, status, recipients,
           error_message, created_at, sent_at
    FROM daily_report_runs
    ORDER BY report_date DESC, id DESC
    LIMIT $1
    `,
    [limit],
  );
  return rows;
}

function getScheduleInfo() {
  return {
    // SMTP_ENABLED=true is required to send anything from this server
    allowedOnServer: getSmtpConfig().enabled,
    cron: process.env.DAILY_REPORT_CRON || "0 21 * * *",
    timezone: REPORT_TIMEZONE,
  };
}

/**
 * Register the 9 PM IST cron. Each run checks the Settings on/off switch;
 * nothing is registered unless SMTP_ENABLED=true.
 */
function scheduleDailyReports(cron) {
  if (!getSmtpConfig().enabled) {
    console.log("[daily-report] disabled on this server (SMTP_ENABLED is not true)");
    return;
  }

  const expression = process.env.DAILY_REPORT_CRON || "0 21 * * *";
  cron.schedule(
    expression,
    async () => {
      try {
        const { enabled, smtp } = await getEffectiveReportConfig();
        if (!enabled) {
          console.log("[daily-report] skipped: turned off in Settings");
          return;
        }
        const smtpProblem = getSmtpProblem(smtp);
        if (smtpProblem) {
          console.warn(`[daily-report] skipped: ${smtpProblem}`);
          return;
        }
      } catch (error) {
        console.error("[daily-report] couldn't read settings:", error.message);
        return;
      }
      for (const report of DAILY_REPORTS) {
        try {
          const result = await sendDailyReport(report);
          console.log(
            `[daily-report] ${report.key}: ${result.status}${result.reason ? ` (${result.reason})` : ""}`,
          );
        } catch (error) {
          console.error(`[daily-report] ${report.key} failed:`, error.message);
        }
      }
    },
    { timezone: REPORT_TIMEZONE },
  );
  console.log(
    `[daily-report] scheduled "${expression}" ${REPORT_TIMEZONE} for ${DAILY_REPORTS.map((r) => r.key).join(", ")}`,
  );
}

module.exports = {
  DAILY_REPORTS,
  buildReportData,
  renderHtml,
  renderText,
  sendDailyReport,
  scheduleDailyReports,
  getRecentRuns,
  getScheduleInfo,
};
