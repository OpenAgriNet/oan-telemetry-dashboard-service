const test = require("node:test");
const assert = require("node:assert/strict");
const requireTelemetryDetail = require("../middleware/requireTelemetryDetail");

function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function invoke(user) {
  const res = response();
  let called = false;
  requireTelemetryDetail({ user }, res, () => { called = true; });
  return { res, called };
}

test("detail permission never follows from super-admin", () => {
  for (const roles of [[], ["viewer"], ["super-admin"], ["super-admin", "viewer"]]) {
    const result = invoke({ realm_access: { roles } });
    assert.equal(result.res.statusCode, 403);
    assert.equal(result.called, false);
  }
  for (const roles of [["telemetry-detail-viewer"], ["super-admin", "telemetry-detail-viewer"]]) {
    assert.equal(invoke({ realm_access: { roles } }).called, true);
  }
});

test("missing, malformed and client-only roles fail closed", () => {
  for (const user of [undefined, {}, { realm_access: { roles: "telemetry-detail-viewer" } },
    { resource_access: { dashboard: { roles: ["telemetry-detail-viewer"] } } }]) {
    assert.equal(invoke(user).res.statusCode, 403);
  }
});

// Replace DB controllers with a handler marker to test actual Express route wiring.
for (const file of ["sessions", "questions", "feedback", "error"]) {
  const id = require.resolve(`../controllers/${file}.controller`);
  require.cache[id] = { id, filename: id, loaded: true, exports: new Proxy({}, {
    get: (_, name) => (req, res) => res.json({ handler: name }),
  }) };
}
const routers = {
  session: require("../routes/sessionRoutes"),
  question: require("../routes/questionRoutes"),
  feedback: require("../routes/feedbackRoutes"),
  error: require("../routes/errorRoutes"),
};
function dispatch(router, url, roles) {
  const res = response();
  const req = { method: "GET", url, user: { realm_access: { roles } } };
  router.handle(req, res, (err) => { if (err) throw err; });
  return res;
}
const detailRoutes = [
  ["session", "/sessions/session-1", "getSessionById"],
  ["question", "/questions/question-1", "getQuestionById"],
  ["question", "/questions/session/session-1", "getQuestionsBySessionId"],
  ["feedback", "/feedback/id/feedback-1", "getFeedbackByid"],
  ["feedback", "/feedback/session/session-1", "getFeedbackBySessionId"],
  ["error", "/errors/id/error-1", "getErrorById"],
  ["error", "/errors/session/session-1", "getErrorsBySessionId"],
];
for (const [name, url, handler] of detailRoutes) {
  test(`${url} rejects super-admin and reaches its controller only with the detail role`, () => {
    for (const roles of [[], ["super-admin"], ["viewer"]]) {
      const res = dispatch(routers[name], url, roles);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.handler, undefined);
    }
    for (const roles of [["telemetry-detail-viewer"], ["super-admin", "telemetry-detail-viewer"]]) {
      assert.equal(dispatch(routers[name], url, roles).body.handler, handler);
    }
  });
}

test("named reports still reach their controllers without the new detail role", () => {
  for (const [name, url, handler] of [
    ["session", "/sessions", "getSessions"], ["session", "/sessions/stats", "getSessionStats"],
    ["session", "/sessions/count", "getTotalSessionsCount"],
    ["question", "/questions/stats", "getQuestionStats"],
    ["question", "/questions/count", "getTotalQuestionsCount"],
    ["feedback", "/feedback", "getAllFeedback"], ["error", "/errors", "getAllErrors"],
  ]) assert.equal(dispatch(routers[name], url, ["super-admin"]).body.handler, handler);
});
