const test = require("node:test");
const assert = require("node:assert/strict");
const { buildScope, scopedQueryParts, PAGE_SIZE } = require("../controllers/serviceApiCalls.controller");

test("scopes a direct API call to its backend, method, endpoint, and parent category", () => {
  const scope = buildScope({ query: {
    sourceService: "mh-provider-backend",
    endpoint: "/webservices/fetch_nearest_five_common_data_by_location_and_category",
    method: "POST",
    kind: "direct",
    categories: JSON.stringify(["chc"]),
  } });
  const parts = scopedQueryParts({
    scope,
    range: { startTimestamp: Date.UTC(2026, 8, 1), endTimestamp: Date.UTC(2026, 8, 2) },
    outcome: "failure",
  });

  assert.equal(PAGE_SIZE, 10);
  assert.match(parts.from, /LEFT JOIN LATERAL/);
  assert.match(parts.where, /direct_event\.service = \$1/);
  assert.match(parts.where, /direct_event\.event_name = \$2/);
  assert.match(parts.where, /parent_request\.service_category/);
  assert.equal(parts.values[0], "mh-provider-backend");
  assert.equal(parts.values[4][0], "chc");
  assert.equal(parts.values.at(-1), "failure");
});

test("scopes a fallback provider operation using its own service category", () => {
  const scope = buildScope({ query: {
    sourceService: "mh-pocradbt-provider-backend",
    endpoint: "/mh-vistaar/status",
    method: "POST",
    kind: "fallback",
    categories: JSON.stringify(["(unclassified)"]),
  } });
  const parts = scopedQueryParts({ scope, range: { startTimestamp: null, endTimestamp: null }, outcome: "" });

  assert.match(parts.where, /direct_event\.event_name = \$2/);
  assert.match(parts.where, /direct_event\.request_payload/);
  assert.doesNotMatch(parts.from, /LEFT JOIN LATERAL/);
  assert.deepEqual(parts.values.at(-1), ["(unclassified)"]);
});

test("rejects invalid scoped API inputs", () => {
  assert.equal(buildScope({ query: { sourceService: "unknown", endpoint: "/x" } }).error, "Invalid source service");
  assert.equal(buildScope({ query: { sourceService: "mh-provider-backend", endpoint: "https://not-a-path" } }).error, "Invalid API endpoint");
  assert.equal(buildScope({ query: { sourceService: "mh-provider-backend", endpoint: "/x", categories: "not-json" } }).error, "Invalid API categories");
});
