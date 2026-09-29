const test = require("node:test");
const assert = require("node:assert/strict");
const { eventFilters } = require("../controllers/individualApiCalls.controller");

test("individual API calls only include captured endpoint calls and use bound filters", () => {
  const values = [];
  const clauses = eventFilters(
    {
      startTimestamp: Date.UTC(2026, 8, 1),
      endTimestamp: Date.UTC(2026, 8, 2),
      outcome: "failure",
      layer: "bap",
      service: "bap-client",
      search: "/search",
    },
    values,
  );

  assert.ok(clauses.includes("trace_scope = 'beckn_external_api'"));
  assert.ok(clauses.includes("NULLIF(TRIM(COALESCE(endpoint, '')), '') IS NOT NULL"));
  assert.ok(clauses.some((clause) => clause.includes("outcome = $3")));
  assert.ok(clauses.some((clause) => clause.includes("layer = $4")));
  assert.ok(clauses.some((clause) => clause.includes("service = $5")));
  assert.ok(clauses.some((clause) => clause.includes("endpoint ILIKE $6")));
  assert.equal(values[2], "failure");
  assert.equal(values[5], "%/search%");
});

test("individual API call filters ignore unsupported outcome values", () => {
  const values = [];
  const clauses = eventFilters(
    { startTimestamp: null, endTimestamp: null, outcome: "anything", layer: "", service: "", search: "" },
    values,
  );

  assert.equal(values.length, 0);
  assert.equal(clauses.length, 2);
});
