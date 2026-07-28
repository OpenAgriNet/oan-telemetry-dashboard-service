const test = require("node:test");
const assert = require("node:assert/strict");
const { DIMENSIONS, RUBRIC_PREFIX, scoreId, normalizeTraceScores } = require("../services/langfuseEvaluationSync");

function score(runId, traceId, name, value, extra = {}) {
  return { id: scoreId(runId, traceId, name), name, value, ...extra };
}

test("run-scoped score IDs are deterministic and isolated", () => {
  assert.equal(scoreId("run-a", "trace-1", "metric"), scoreId("run-a", "trace-1", "metric"));
  assert.notEqual(scoreId("run-a", "trace-1", "metric"), scoreId("run-b", "trace-1", "metric"));
});

test("normalizes a complete 18-metric Langfuse trace", () => {
  const runId = "production-2026-07-22";
  const traceId = "trace-1";
  const scores = [];
  for (const [dimension, metrics] of Object.entries(DIMENSIONS)) {
    for (const metric of metrics) {
      const name = `${RUBRIC_PREFIX}.${dimension}.${metric}`;
      scores.push(score(runId, traceId, name, 4, { comment: `${metric} evidence` }));
    }
    scores.push(score(runId, traceId, `${RUBRIC_PREFIX}.dimension.${dimension}`, 4));
  }
  scores.push(score(runId, traceId, `${RUBRIC_PREFIX}.overall`, 4, { comment: "Strong answer", timestamp: "2026-07-22T00:00:00Z" }));
  scores.push(score(runId, traceId, `${RUBRIC_PREFIX}.pass`, 1));
  scores.push(score(runId, traceId, `${RUBRIC_PREFIX}.category`, "Weather"));
  scores.push(score(runId, traceId, `${RUBRIC_PREFIX}.agristack_required`, "Yes"));
  const result = normalizeTraceScores(runId, {
    id: traceId, input: "Question", output: "Answer", scores,
    metadata: { qid: "q-1", target_lang: "mr" }, tags: ["model:gemma-4"],
  }, { selection_source: "feedback", feedback_types: ["dislike"], feedback_count: 1 });
  assert.equal(result.complete, true);
  assert.equal(result.item.evaluation.metrics.overall_average, 4);
  assert.equal(result.item.evaluation.metrics.overall_pass, true);
  assert.equal(result.item.evaluation.dimensions.marathi_quality.scores.grammar.score, 4);
  assert.equal(result.item.serving_model, "gemma-4");
});

test("distinguishes not-applicable metrics from missing scores", () => {
  const runId = "run";
  const traceId = "trace";
  const metric = `${RUBRIC_PREFIX}.marathi_quality.grammar`;
  const result = normalizeTraceScores(runId, {
    id: traceId,
    scores: [{
      id: scoreId(runId, traceId, `${metric}.applicability`),
      name: `${metric}.applicability`, stringValue: "not_applicable", comment: "Answer was not Marathi",
    }],
  }, { selection_source: "random" });
  assert.equal(result.item.evaluation.dimensions.marathi_quality.scores.grammar.score, null);
  assert.equal(result.missing.includes(metric), false);
  assert.equal(result.complete, false);
});
