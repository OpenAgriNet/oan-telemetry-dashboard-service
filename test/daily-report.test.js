const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const NOW = Date.parse("2026-11-04T15:30:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function loadModule(relative, overrides) {
  const filename = resolve(__dirname, "..", relative);
  const module = { exports: {} };
  const realRequire = createRequire(filename);
  vm.runInNewContext(readFileSync(filename, "utf8"), {
    module,
    require: (id) => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id),
    console: { log() {}, warn() {}, error() {} },
    process: { env: {} },
  }, { filename });
  return module.exports;
}

function loadReport({ empty = false, statsFailure = false, sendFailure = false, claimed = true } = {}) {
  const queries = [];
  const messages = [];
  const config = {
    enabled: true,
    recipients: ["reports@example.test"],
    smtp: { enabled: true, configured: true, from: "sender@example.test", port: 587 },
  };
  const counts = [
    { api_service: "pmkisan_send_otp", total: 60, success: 10, rejected: 47, error: 3, avg_latency_ms: 1200 },
    { api_service: "pmkisan_grievance_lodge", total: 7, success: 1, rejected: 5, error: 1, avg_latency_ms: 40 },
    { api_service: "pmkisan_grievance_aadhaar_token", total: 100, success: 0, rejected: 100, error: 0 },
    { api_service: "voice_chat_completions", total: 99, success: 0, rejected: 0, error: 99 },
    { api_service: "pmkisan_new_api", total: 2, success: 0, rejected: 0, error: 2, avg_latency_ms: 10 },
  ];
  const failures = [
    { api_service: "pmkisan_send_otp", is_rejected: true, error_type: "record", rejection_message: "rejected: No Record Found for private-id-a", count: "30" },
    { api_service: "pmkisan_send_otp", is_rejected: true, error_type: "record", rejection_message: "No Record Found for private-id-b", count: "15" },
    { api_service: "pmkisan_send_otp", is_rejected: true, error_type: "invalid_otp", rejection_message: "Invalid OTP private-otp", count: "2" },
    { api_service: "pmkisan_send_otp", is_rejected: false, error_type: "timeout", count: "3" },
    { api_service: "pmkisan_grievance_lodge", is_rejected: true, error_type: "duplicate", rejection_message: "rejected: Grievance already registered.", count: "3" },
    { api_service: "pmkisan_grievance_lodge", is_rejected: true, error_type: "exception", rejection_message: "System.IndexOutOfRangeException: private-stack-trace", count: "2" },
    { api_service: "pmkisan_grievance_lodge", is_rejected: false, error_type: "timeout", count: "1" },
    { api_service: "pmkisan_grievance_aadhaar_token", is_rejected: true, rejection_message: "No Record Found", count: "100" },
    { api_service: "voice_chat_completions", is_rejected: false, error_type: "voice-only-error", count: "99" },
    { api_service: "pmkisan_new_api", is_rejected: false, error_type: '<upstream & "error">', count: "2" },
  ];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM ext_api_calls")) {
        if (statsFailure) throw new Error("stats unavailable");
        if (empty) return { rows: [] };
        if (sql.includes("AS tool_calls")) return { rows: [{ service_id: "pmkisan", tool_calls: 28 }] };
        if (sql.includes("AS is_rejected")) return { rows: failures };
        if (sql.includes("GROUP BY api_service")) return { rows: counts };
        return { rows: [] };
      }
      if (sql.includes("RETURNING id")) return { rows: claimed ? [{ id: 12 }] : [] };
      return { rows: [] };
    },
  };
  const stats = loadModule("controllers/becknExt.controller.js", { "../services/db": pool });
  const service = loadModule("controllers/serviceCheck.controller.js", {
    "../services/db": pool, "./becknExt.controller": stats,
  });
  const transport = {
    async sendMail(message) {
      if (sendFailure) throw new Error("SMTP unavailable");
      messages.push(message);
    },
  };
  const report = loadModule("services/dailyReport.js", {
    nodemailer: { createTransport: () => transport },
    "./db": pool,
    "../controllers/becknExt.controller": stats,
    "../controllers/serviceCheck.controller": service,
    "./reportSettings": {
      getEffectiveReportConfig: async () => config,
      getSmtpConfig: () => config.smtp,
      getSmtpProblem: () => config.smtp.configured ? null : "SMTP not configured",
    },
  });
  return { ...report, queries, messages, config };
}

test("daily PM-KISAN rows reuse dashboard normalization and preserve the existing scope and counts", async () => {
  const report = loadReport();
  const data = await report.buildReportData(report.DAILY_REPORTS[0], NOW);
  const byApi = Object.fromEntries(data.rows.map((row) => [row.apiService, row]));
  const send = byApi.pmkisan_send_otp;
  assert.equal(send.label, "PM KISAN OTP SEND");
  assert.equal(send.requests, 60);
  assert.equal(send.failed, 50);
  assert.equal(send.rejectedTypes.map((type) => `${type.errorType} (${type.count})`).join(", "), "No Record Found (45), unknown (2)");
  assert.equal(send.errorTypes[0].errorType, "timeout");
  assert.equal(send.errorTypes[0].count, 3);
  const lodge = byApi.pmkisan_grievance_lodge;
  assert.equal(lodge.rejectedTypes.map((type) => `${type.errorType} (${type.count})`).join(", "), "Grievance already registered. (3), System.IndexOutOfRangeException (2)");
  assert.equal(byApi.pmkisan_new_api.errorTypes[0].count, 2);
  assert.equal(byApi.pmkisan_verify_otp.rejectedTypes.length, 0);
  assert.equal(byApi.pmkisan_verify_otp.errorTypes.length, 0);
  assert.equal(byApi.pmkisan_grievance_aadhaar_token, undefined);
  assert.equal(byApi.voice_chat_completions, undefined);
  assert.equal(data.total.requests, 69);
  assert.equal(data.total.rejected, 52);
  assert.equal(data.total.error, 6);
  assert.equal(data.toolCalls, 28);
  assert.equal(data.startMs, NOW - DAY_MS);
  assert.equal(data.endMs, NOW);
  assert.equal(report.queries.length, 4);
  for (const { sql, params } of report.queries) {
    assert.match(sql, /ets >=/);
    assert.match(sql, /ets <=/);
    assert.ok(params.includes(NOW - DAY_MS));
    assert.ok(params.includes(NOW));
    assert.ok(JSON.stringify(params).includes("BharatVistaar"));
  }
});

test("HTML and plain-text mail show both per-API breakdowns, escape HTML and retain zero-call rows", async () => {
  const report = loadReport();
  const { message, data, status } = await report.sendDailyReport(undefined, { dryRun: true, now: NOW });
  assert.equal(status, "dry-run");
  assert.equal(report.messages.length, 0);
  for (const output of [message.html, message.text]) {
    for (const label of [
      "Rejection reasons", "Error types", "No Record Found (45)", "unknown (2)",
      "Grievance already registered. (3)", "System.IndexOutOfRangeException (2)",
      "timeout (3)", "OTP VALIDATE",
    ]) assert.ok(output.includes(label), label);
    assert.doesNotMatch(output, /private-id|private-otp|private-stack|voice-only-error/);
  }
  assert.ok(message.html.includes('&lt;upstream &amp; "error"&gt; (2)'));
  assert.ok(!message.html.includes('<upstream & "error">'));
  assert.ok(message.text.includes('<upstream & "error"> (2)'));
  const htmlRows = [...message.html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((match) => match[1]).filter((row) => /PM KISAN OTP SEND|OTP VALIDATE|>Total</.test(row));
  assert.equal(htmlRows.length, 3);
  for (const row of htmlRows) assert.equal((row.match(/<td\b/g) || []).length, 7);
  const zeroRow = htmlRows.find((row) => row.includes("OTP VALIDATE"));
  assert.match(zeroRow, /Rejection reasons|—/);
  const zero = data.rows.find((row) => row.apiService === "pmkisan_verify_otp");
  assert.equal(zero.requests, 0);
});

test("empty reports render dashes rather than undefined reasons", async () => {
  const report = loadReport({ empty: true });
  const { data, message } = await report.sendDailyReport(undefined, { dryRun: true, now: NOW });
  assert.equal(data.rows.length, 6);
  assert.equal(data.total.requests, 0);
  assert.match(message.text, /Rejection reasons: —/);
  assert.match(message.text, /Error types: —/);
  assert.doesNotMatch(message.html + message.text, /undefined|NaN/);
});

test("scheduled and manual sends include the new columns while preserving the daily guard", async () => {
  const report = loadReport();
  const result = await report.sendDailyReport(undefined, { now: NOW });
  assert.equal(result.status, "sent");
  assert.equal(report.messages[0].to, "reports@example.test");
  assert.match(report.messages[0].html, /Rejection reasons/);
  assert.match(report.messages[0].text, /Error types/);
  const finish = report.queries.find(({ sql }) => sql.includes("UPDATE daily_report_runs"));
  assert.equal(finish.params[1], "sent");
  assert.equal(JSON.parse(finish.params[3]).rows[0].rejectedTypes[0].count, 45);
  assert.equal(report.queries.find(({ sql }) => sql.includes("RETURNING id")).params[1], "2026-11-04");

  const skipped = loadReport({ claimed: false });
  assert.equal((await skipped.sendDailyReport(undefined, { now: NOW })).status, "skipped");
  assert.equal(skipped.messages.length, 0);
  await skipped.sendDailyReport(undefined, { now: NOW, to: ["manual@example.test"] });
  assert.equal(skipped.messages[0].to, "manual@example.test");
});

test("data and delivery failures remain explicit and do not send a success-shaped report", async () => {
  const missingStats = loadReport({ statsFailure: true });
  await assert.rejects(missingStats.sendDailyReport(undefined, { now: NOW }), /stats unavailable/);
  assert.equal(missingStats.messages.length, 0);
  const smtpFailure = loadReport({ sendFailure: true });
  await assert.rejects(smtpFailure.sendDailyReport(undefined, { now: NOW }), /SMTP unavailable/);
  const finish = smtpFailure.queries.find(({ sql }) => sql.includes("UPDATE daily_report_runs"));
  assert.equal(finish.params[1], "failed");
  assert.equal(finish.params[4], "SMTP unavailable");
});
