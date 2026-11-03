const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { SERVICE_CHECKS, findServiceForApi } = require("../utils/serviceCheckConfig");

const queries = [];
const pool = {
  async query(sql, params) {
    queries.push({ sql, params });
    return { rows: [{ service_id: "voice", tool_calls: 8 }] };
  },
};
const { groupByService, getToolCallsByService } = loadController("serviceCheck.controller", {
  "../services/db": pool,
  "./becknExt.controller": {
    buildExtApiCallFilters: () => ({ where: "WHERE channel = $1", queryParams: ["BharatVistaar-voice"] }),
  },
});

test("Voice is configured alongside PM-KISAN with a zero-call row", () => {
  assert.equal(findServiceForApi("voice_chat_completions").label, "Voice");
  assert.ok(SERVICE_CHECKS.some((service) => service.id === "pmkisan"));
  const services = groupByService([], []);
  const voice = services.find((service) => service.id === "voice");
  assert.equal(voice.apis.length, 1);
  assert.equal(voice.apis[0].label, "Chat Completions");
  assert.equal(voice.totals.total, 0);
  assert.equal(voice.apis[0].lastCallAt, null);
  assert.equal(voice.apis[0].rejectedTypes.length, 0);
});

test("Voice uses the existing completed/rejected/error aggregation", () => {
  const counts = { total: 8, success: 5, rejected: 2, error: 1, unknown: 0 };
  const services = groupByService([{
    apiService: "voice_chat_completions", ...counts,
    avgLatencyMs: 125, maxLatencyMs: 500, lastCallAt: "2026-11-02 12:00",
  }], [{ apiService: "voice_chat_completions", errorType: "TimeoutError", count: 1 }],
  [{ apiService: "voice_chat_completions", errorType: "http_401", count: 2 }]);
  const voice = services.find((service) => service.id === "voice");
  assert.equal(voice.totals.failed, 3);
  assert.equal(voice.totals.successRate, 63);
  assert.equal(voice.apis[0].rejected, 2);
  assert.equal(voice.apis[0].avgLatencyMs, 125);
  assert.equal(voice.apis[0].errorTypes[0].count, 1);
  assert.equal(voice.apis[0].rejectedTypes[0].errorType, "http_401");
  assert.equal(voice.apis[0].rejectedTypes[0].count, 2);
  assert.equal(services.find((service) => service.id === "pmkisan").apis.length, 7);
  assert.equal(services.find((service) => service.id === "pmkisan").apis[0].rejectedTypes.length, 0);
});

test("Voice tool calls use the event ID fallback, not the voice session count", async () => {
  const result = await getToolCallsByService({});
  assert.equal(result.voice, 8);
  assert.ok(queries[0].params.includes("voice\\_%"));
  assert.match(queries[0].sql, /COUNT\(DISTINCT COALESCE\(question_id::text, NULLIF\(beckn_transaction_id, ''\), mid\)\)/);
});

function loadController(name, overrides) {
  const file = resolve(__dirname, `../controllers/${name}.js`);
  const result = { exports: {} };
  const realRequire = createRequire(file);
  vm.runInNewContext(readFileSync(file, "utf8"), {
    module: result,
    require: (id) => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id),
    console: { error() {} },
  }, { filename: file });
  return result.exports;
}

test("stats and handler keep rejected types separate and apply identical filters", async () => {
  const calls = [];
  const counts = { total: 7, success: 1, rejected: 5, error: 1, unknown: 0 };
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("AS tool_calls")) return { rows: [{ service_id: "voice", tool_calls: 7 }] };
    if (sql.includes("AS is_rejected")) {
      return { rows: [
        { api_service: "voice_chat_completions", error_type: "http_401", count: "3", is_rejected: true },
        { api_service: "voice_chat_completions", error_type: "unknown", count: "2", is_rejected: true },
        { api_service: "voice_chat_completions", error_type: "http_401", count: "1", is_rejected: false },
      ] };
    }
    if (sql.includes("GROUP BY api_service")) {
      return { rows: [{ api_service: "voice_chat_completions", ...counts }] };
    }
    return { rows: [counts] };
  } };
  const statsController = loadController("becknExt.controller", { "../services/db": db });
  const telemetryState = { exactChannels: ["BharatVistaar"], prefixChannels: ["BharatVistaar-"] };
  const range = { startDate: "2026-11-01", endDate: "2026-11-02", telemetryState };
  const stats = await statsController.getExtApiCallStats({
    ...range, apiService: "voice_chat_completions", apiPrefix: "voice_",
  });
  assert.equal(stats.rejectedTypes.length, 1);
  assert.equal(stats.rejectedTypes[0].errorType, "unknown");
  assert.equal(stats.rejectedTypes.reduce((sum, type) => sum + type.count, 0), counts.rejected);
  assert.equal(stats.errorTypes.length, 1);
  assert.equal(stats.errorTypes[0].count, 1);
  const breakdown = calls.find(({ sql }) => sql.includes("AS is_rejected"));
  assert.match(breakdown.sql, /COALESCE\(outcome = 'rejected', false\) AS is_rejected/);
  assert.match(breakdown.sql, /success IS FALSE OR outcome = 'rejected'/);
  assert.match(breakdown.sql, /COALESCE\(NULLIF\(BTRIM\(error_type\), ''\), 'unknown'\)/);
  assert.match(breakdown.sql, /GROUP BY.*is_rejected/);
  assert.match(breakdown.sql, /ORDER BY count DESC/);
  assert.match(breakdown.sql, /CASE WHEN outcome = 'rejected' THEN error END AS rejection_message/);
  assert.match(breakdown.sql, /GROUP BY.*rejection_message/);
  for (const { sql, params } of calls) {
    assert.equal(JSON.stringify(params), JSON.stringify(calls[0].params));
    for (const filter of ["channel", "ets >=", "ets <=", "api_service =", "api_service LIKE"]) {
      assert.ok(sql.includes(filter), filter);
    }
  }

  const service = loadController("serviceCheck.controller", {
    "../services/db": db, "./becknExt.controller": statsController,
  });
  let body;
  let status;
  const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
  await service.getServiceCheckHandler({
    query: { startDate: range.startDate, endDate: range.endDate, service: "voice" },
    telemetryState,
  }, res);
  assert.equal(status, 200);
  assert.equal(body.services.length, 1);
  assert.equal(body.services[0].apis[0].rejectedTypes[0].count, 5);
  assert.equal(body.services[0].apis[0].rejectedTypes[0].errorType, "unknown");
  assert.equal(body.services[0].apis[0].errorTypes[0].count, 1);
  assert.equal(body.services[0].apis[0].errorTypes[0].errorType, "http_401");

  db.query = async () => ({ rows: [] });
  const empty = await statsController.getExtApiCallStats(range);
  assert.equal(empty.errorTypes.length, 0);
  assert.equal(empty.rejectedTypes.length, 0);

  db.query = async () => { throw new Error("database unavailable"); };
  await service.getServiceCheckHandler({ query: {}, telemetryState }, res);
  assert.equal(status, 500);
});

test("unmatched rejection messages and missing messages merge as unknown without altering error labels", async () => {
  const rows = [
    { error_type: "unknown", rejection_message: "rejected: Grievance already registered", count: "3" },
    { error_type: "duplicate", rejection_message: "  REJECTED:  Grievance already registered  ", count: "2" },
    { error_type: "unknown", rejection_message: "rejected: Registration number wrong", count: "4" },
    { error_type: "unknown", rejection_message: "rejected: Invalid registration number UP123456789", count: "1" },
    { error_type: "unknown", rejection_message: "rejected: Invalid registration number UP987654321", count: "1" },
    { error_type: "http_401", rejection_message: null, count: "2" },
    { error_type: "unknown", rejection_message: "rejected: no message", count: "1" },
    { error_type: "unknown", rejection_message: "rejected: ", count: "1" },
    { error_type: "invalid_otp", rejection_message: "rejected: Invalid OTP 123456 for farmer@example.test", count: "1" },
  ].map((row) => ({ api_service: "pmkisan_grievance_lodge", is_rejected: true, ...row }));
  rows.push({
    api_service: "pmkisan_verify_otp", is_rejected: true, error_type: "unknown",
    rejection_message: "rejected: Registration number wrong", count: "1",
  }, {
    api_service: "pmkisan_grievance_lodge", is_rejected: false, error_type: "timeout",
    rejection_message: "must not be displayed", count: "2",
  });
  const controller = loadController("becknExt.controller", {
    "../services/db": {
      query: async (sql) => ({ rows: sql.includes("AS is_rejected") ? rows : [] }),
    },
  });
  const stats = await controller.getExtApiCallStats({});
  const reasons = stats.rejectedTypes.filter((row) => row.apiService === "pmkisan_grievance_lodge");
  assert.equal(reasons.length, 2);
  assert.equal(reasons[0].errorType, "unknown");
  assert.equal(reasons[0].count, 11);
  assert.equal(reasons[1].errorType, "Grievance already registered.");
  assert.equal(reasons[1].count, 5);
  assert.equal(reasons.reduce((sum, row) => sum + row.count, 0), 16);
  assert.equal(stats.rejectedTypes.find((row) => row.apiService === "pmkisan_verify_otp").count, 1);
  assert.equal(stats.errorTypes[0].errorType, "timeout");
  assert.equal(stats.errorTypes[0].count, 2);
  const output = JSON.stringify(stats);
  for (const sensitive of ["UP123456789", "UP987654321", "123456", "farmer@example.test", "must not be displayed"]) {
    assert.ok(!output.includes(sensitive), sensitive);
  }
  for (const detail of ["Registration number wrong", "Invalid registration number", "Invalid OTP", "http_401", "no message"]) {
    assert.ok(!output.includes(detail), detail);
  }
});

test("short rejection labels merge record-not-found counts and remove exception details without changing errors", async () => {
  const rows = [
    { rejection_message: "rejected: No Record Found for this (TN111111111) Aadhar/Ben_id/Mobile.", count: "20" },
    { rejection_message: "rejected: no record found for this (TN222222222) Aadhar/Ben_id/Mobile.", count: "25" },
    { rejection_message: "rejected: Grievance already registered.", count: "1" },
    { rejection_message: "rejected: System.IndexOutOfRangeException: Cannot find table 0. at System.Data.DataTableCollection.get_Item(Int32 index)\n at GrievanceServiceTest.GrievanceStatusCheck() in e:\\server\\App_Code.cs:line 626", count: "1" },
    { rejection_message: "rejected: Invalid registration number", count: "2" },
  ].map((row) => ({
    api_service: "pmkisan_grievance_status", is_rejected: true, error_type: "unknown", ...row,
  }));
  rows.push({
    api_service: "pmkisan_grievance_status", is_rejected: false,
    error_type: "http_error", rejection_message: null, count: "7",
  });
  const controller = loadController("becknExt.controller", {
    "../services/db": { query: async (sql) => ({ rows: sql.includes("AS is_rejected") ? rows : [] }) },
  });
  const stats = await controller.getExtApiCallStats({});
  const reasons = Object.fromEntries(stats.rejectedTypes.map((row) => [row.errorType, row.count]));
  assert.deepEqual(reasons, {
    "No Record Found": 45,
    unknown: 2,
    "Grievance already registered.": 1,
    "System.IndexOutOfRangeException": 1,
  });
  assert.equal(stats.rejectedTypes.reduce((sum, row) => sum + row.count, 0), 49);
  assert.equal(stats.errorTypes[0].errorType, "http_error");
  assert.equal(stats.errorTypes[0].count, 7);
  const output = JSON.stringify(stats);
  for (const detail of ["TN111111111", "TN222222222", "Aadhar/Ben_id/Mobile", "Cannot find table", "GrievanceServiceTest", "App_Code", "626"]) {
    assert.ok(!output.includes(detail), detail);
  }
});
