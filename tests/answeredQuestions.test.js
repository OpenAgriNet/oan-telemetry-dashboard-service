const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../services/db");
const questions = require("../controllers/questions.controller");
const sessions = require("../controllers/sessions.controller");

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

function checkQuestionFilters(sql) {
  // Restrict every questions-table branch, not the feedback/error branches of a UNION.
  const branches = sql.split(/FROM questions/).slice(1);
  assert.ok(branches.length);
  for (const branch of branches) {
    assert.match(branch.split(/UNION/)[0], /answertext IS NOT NULL AND answertext <> ''/);
  }
}

test("question-only event IDs return 404 rather than an empty answer detail", async (t) => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  t.mock.method(pool, "query", async (query) => {
    checkQuestionFilters(query.text);
    assert.deepEqual(query.values, [id]);
    return { rows: [] };
  });
  const res = response();
  await questions.getQuestionById({ params: { id }, query: {} }, res);
  assert.equal(res.statusCode, 404);
});

test("completed question details keep the original question and full answer", async (t) => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const answer = "Full answer ".repeat(100);
  t.mock.method(pool, "query", async (query) => {
    checkQuestionFilters(query.text);
    return { rows: [{ id, question: "Which crop?", answer }] };
  });
  const res = response();
  await questions.getQuestionById({ params: { id }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.answer, answer);
});

test("session question results and pagination counts retain the same date bounds", async (t) => {
  const seen = [];
  t.mock.method(pool, "query", async (query) => {
    checkQuestionFilters(query.text);
    assert.match(query.text, /ets >= \$2/);
    assert.match(query.text, /ets <= \$3/);
    seen.push(query.values);
    return { rows: /COUNT/.test(query.text) ? [{ total: "0" }] : [] };
  });
  const res = response();
  await questions.getQuestionsBySessionId({ params: { sessionId: "s1" },
    query: { startDate: "2026-10-01", endDate: "2026-10-02" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(res.body.data, []);
  assert.equal(res.body.pagination.totalItems, 0);
});

for (const [name, handler, params] of [
  ["question reports", questions.getQuestions, {}],
  ["user questions", questions.getQuestionsByUserId, { userId: "u1" }],
  ["question totals", questions.getQuestionStats, {}],
  ["question graphs", questions.getQuestionsGraph, {}],
  ["session reports", sessions.getSessions, {}],
  ["user sessions", sessions.getSessionsByUserId, { userId: "u1" }],
  ["session totals", sessions.getSessionStats, {}],
  ["session graphs", sessions.getSessionsGraph, {}],
]) {
  test(`${name} exclude empty and null answers before counting or paginating`, async (t) => {
    let calls = 0;
    t.mock.method(pool, "query", async (query) => {
      const sql = typeof query === "string" ? query : query.text;
      checkQuestionFilters(sql);
      calls++;
      return { rows: /SELECT COUNT\((?:\*|DISTINCT sid)\) as total\b/.test(sql) ? [{ total: "0" }] :
        /as total_questions/.test(sql) ? [{ total_questions: "0" }] :
        /as total_sessions/.test(sql) ? [{ total_sessions: "0" }] : [] };
    });
    const res = response();
    await handler({ params, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(calls);
  });
}
