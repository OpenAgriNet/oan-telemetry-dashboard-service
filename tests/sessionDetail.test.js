const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../services/db");
const { getSessionById } = require("../controllers/sessions.controller");
const { getQuestionsBySessionId } = require("../controllers/questions.controller");
const { getFeedbackBySessionId } = require("../controllers/feedback.controller");

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

test("restored session details retain feedback, errors and unanswered questions", async (t) => {
  t.mock.method(pool, "query", async (query) => {
    assert.deepEqual(query.values, ["session-1"]);
    assert.match(query.text, /feedbacktext, feedbacktype/);
    assert.match(query.text, /errortext AS questiontext/);
    assert.doesNotMatch(query.text, /answertext IS NOT NULL/);
    return { rows: [
      { id: "q1", uid: "user", type: "question", questiontext: "Question", answertext: null },
      { id: "f1", uid: "user", type: "feedback", feedbacktext: "Helpful", feedbacktype: "like" },
      { id: "e1", uid: "user", type: "error", questiontext: "Timeout", channel: "web" },
    ] };
  });
  const res = response();
  await getSessionById({ params: { sessionId: "session-1" }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.totalItems, 3);
  assert.equal(res.body.data.questions[0].answerText, null);
  assert.equal(res.body.data.feedback[0].feedbackText, "Helpful");
  assert.equal(res.body.data.feedback[0].feedbackType, "like");
  assert.equal(res.body.data.errors[0].errorMessage, "Timeout");
  assert.equal(res.body.data.errors[0].channel, "web");
});

test("missing sessions return 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = response();
  await getSessionById({ params: { sessionId: "missing" }, query: {} }, res);
  assert.equal(res.statusCode, 404);
});

test("session question endpoint includes questions without an answer", async (t) => {
  t.mock.method(pool, "query", async (query) => {
    assert.doesNotMatch(query.text, /answertext IS NOT NULL/);
    return /COUNT/.test(query.text) ? { rows: [{ total: "1" }] } :
      { rows: [{ id: "q1", question: "Unanswered", answer: null }] };
  });
  const res = response();
  await getQuestionsBySessionId({ params: { sessionId: "s1" }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].answer, null);
});

test("session feedback includes rating-only records and preserves the full answer", async (t) => {
  const answer = "Full answer ".repeat(30);
  t.mock.method(pool, "query", async (query) => {
    const sql = typeof query === "string" ? query : query.text;
    assert.doesNotMatch(sql, /feedbacktext IS NOT NULL/);
    if (/COUNT/.test(sql)) return { rows: [{ total: "1" }] };
    if (/SUM/.test(sql)) return { rows: [{ total_likes: "1", total_dislikes: "0" }] };
    return { rows: [{ id: "f1", feedbacktype: "like", feedbacktext: null, answertext: answer }] };
  });
  const res = response();
  await getFeedbackBySessionId({ params: { sessionId: "s1" }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].rating, "like");
  assert.equal(res.body.data[0].answer, answer);
});
