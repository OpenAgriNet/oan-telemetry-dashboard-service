const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../services/db");
const { getServiceSnapshot } = require("../controllers/serviceSnapshot.controller");

test("filters excluded provider requests in the snapshot query without filtering direct API events", async () => {
  const originalQuery = pool.query;
  const queries = [];
  pool.query = async query => {
    queries.push(query.text);
    return { rows: [] };
  };
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  try {
    await getServiceSnapshot({ query: {} }, res);
    assert.equal(res.code, 200);
    assert.match(queries[0], /provider_event\.service <> 'mh-provider-backend'/);
    assert.match(queries[0], /advisory-agri-qdrant/);
    assert.match(queries[0], /\{message,intent,provider,id\}/);
    assert.doesNotMatch(queries[1], /advisory-agri-qdrant|\{message,intent,provider,id\}/);
  } finally {
    pool.query = originalQuery;
  }
});
