const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { SERVICE_CHECKS, findServiceForApi } = require("../utils/serviceCheckConfig");

const filename = resolve(__dirname, "../controllers/serviceCheck.controller.js");
const localRequire = createRequire(filename);
const queries = [];
const pool = {
  async query(sql, params) {
    queries.push({ sql, params });
    return { rows: [{ service_id: "voice", tool_calls: 8 }] };
  },
};
const moduleStub = { exports: {} };
vm.runInNewContext(readFileSync(filename, "utf8"), {
  module: moduleStub,
  require: (id) => {
    if (id === "../services/db") return pool;
    if (id === "./becknExt.controller") {
      return {
        buildExtApiCallFilters: () => ({ where: "WHERE channel = $1", queryParams: ["BharatVistaar-voice"] }),
      };
    }
    return localRequire(id);
  },
}, { filename });
const { groupByService, getToolCallsByService } = moduleStub.exports;

test("Voice is configured alongside PM-KISAN with a zero-call row", () => {
  assert.equal(findServiceForApi("voice_chat_completions").label, "Voice");
  assert.ok(SERVICE_CHECKS.some((service) => service.id === "pmkisan"));
  const services = groupByService([], []);
  const voice = services.find((service) => service.id === "voice");
  assert.equal(voice.apis.length, 1);
  assert.equal(voice.apis[0].label, "Chat Completions");
  assert.equal(voice.totals.total, 0);
  assert.equal(voice.apis[0].lastCallAt, null);
});

test("Voice uses the existing completed/rejected/error aggregation", () => {
  const counts = { total: 8, success: 5, rejected: 2, error: 1, unknown: 0 };
  const services = groupByService([{
    apiService: "voice_chat_completions", ...counts,
    avgLatencyMs: 125, maxLatencyMs: 500, lastCallAt: "2026-11-02 12:00",
  }], [{ apiService: "voice_chat_completions", errorType: "TimeoutError", count: 1 }]);
  const voice = services.find((service) => service.id === "voice");
  assert.equal(voice.totals.failed, 3);
  assert.equal(voice.totals.successRate, 63);
  assert.equal(voice.apis[0].rejected, 2);
  assert.equal(voice.apis[0].avgLatencyMs, 125);
  assert.equal(voice.apis[0].errorTypes[0].count, 1);
  assert.equal(services.find((service) => service.id === "pmkisan").apis.length, 7);
});

test("Voice tool calls use the event ID fallback, not the voice session count", async () => {
  const result = await getToolCallsByService({});
  assert.equal(result.voice, 8);
  assert.ok(queries[0].params.includes("voice\\_%"));
  assert.match(queries[0].sql, /COUNT\(DISTINCT COALESCE\(question_id::text, NULLIF\(beckn_transaction_id, ''\), mid\)\)/);
});
