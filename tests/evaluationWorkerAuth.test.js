const test = require("node:test");
const assert = require("node:assert/strict");
const evaluationWorkerAuth = require("../middleware/evaluationWorkerAuth");

function invoke(headers = {}) {
  let statusCode = 200;
  let payload;
  let nextCalled = false;
  const req = { get: (name) => headers[name.toLowerCase()] };
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };
  evaluationWorkerAuth(req, res, () => { nextCalled = true; });
  return { statusCode, payload, nextCalled };
}

test("worker authentication rejects requests when no key is configured", () => {
  delete process.env.EVALUATION_SERVICE_KEY;
  const result = invoke();
  assert.equal(result.statusCode, 503);
  assert.equal(result.nextCalled, false);
});

test("worker authentication requires the configured service key", () => {
  process.env.EVALUATION_SERVICE_KEY = "secret";
  assert.equal(invoke({ "x-evaluation-service-key": "wrong" }).statusCode, 401);
  assert.equal(invoke({ "x-evaluation-service-key": "secret" }).nextCalled, true);
  delete process.env.EVALUATION_SERVICE_KEY;
});
