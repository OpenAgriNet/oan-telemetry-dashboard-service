const axios = require("axios");
const { v5: uuidv5 } = require("uuid");

const SCORE_NAMESPACE = "4f74243c-12bb-4ee8-8953-18a62e5d1850";
const RUBRIC_PREFIX = "mh_eval.v1";
const DIMENSIONS = {
  process_fidelity: ["agristack_workflow", "term_identification", "tool_sequencing", "search_quality", "output_hygiene"],
  factual_grounding: ["source_alignment", "no_fabrication", "citation_accuracy", "safety_compliance"],
  response_usefulness: ["completeness", "actionability", "context_fit", "clarity", "conversation_closure"],
  marathi_quality: ["grammar", "terminology", "language_purity", "fluency"],
};

const scoreId = (runId, traceId, name) => uuidv5(`${runId}|${traceId}|${name}`, SCORE_NAMESPACE);

const textValue = (value) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    for (const key of ["output", "text", "content", "answer"]) {
      if (typeof value[key] === "string") return value[key];
    }
  }
  return value == null ? "" : JSON.stringify(value);
};

const scoreValue = (score) => {
  if (!score) return null;
  if (score.stringValue != null) return score.stringValue;
  if (score.value != null) return score.value;
  return score.booleanValue ?? null;
};

const booleanScoreValue = (score) => {
  const value = scoreValue(score);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return String(value).toLowerCase() === "true";
};

function normalizeDimensions(byName) {
  const dimensions = {};
  const missing = [];
  for (const [dimensionName, metricNames] of Object.entries(DIMENSIONS)) {
    const metricScores = {};
    for (const metricName of metricNames) {
      const name = `${RUBRIC_PREFIX}.${dimensionName}.${metricName}`;
      const numeric = byName(name);
      const applicability = byName(`${name}.applicability`);
      if (!numeric && scoreValue(applicability) !== "not_applicable") missing.push(name);
      metricScores[metricName] = {
        score: numeric ? Number(scoreValue(numeric)) : null,
        evidence: numeric?.comment || applicability?.comment || "N/A - metric not applicable",
      };
    }
    const averageScore = byName(`${RUBRIC_PREFIX}.dimension.${dimensionName}`);
    dimensions[dimensionName] = {
      scores: metricScores,
      average: averageScore ? Number(scoreValue(averageScore)) : null,
    };
  }

  return { dimensions, missing };
}

function normalizeTraceScores(runId, trace, manifest) {
  const scores = new Map((trace.scores || []).map((score) => [score.id, score]));
  const byName = (name) => scores.get(scoreId(runId, trace.id, name));
  const { dimensions, missing } = normalizeDimensions(byName);

  const overall = byName(`${RUBRIC_PREFIX}.overall`);
  const pass = byName(`${RUBRIC_PREFIX}.pass`);
  const category = byName(`${RUBRIC_PREFIX}.category`);
  const agristack = byName(`${RUBRIC_PREFIX}.agristack_required`);
  if (!overall) missing.push(`${RUBRIC_PREFIX}.overall`);
  if (!pass) missing.push(`${RUBRIC_PREFIX}.pass`);
  const criticalKeys = ["factual_grounding.source_alignment", "factual_grounding.no_fabrication", "factual_grounding.safety_compliance"];
  const criticalFailures = criticalKeys.filter((key) => {
    const [dimension, metric] = key.split(".");
    return dimensions[dimension].scores[metric].score === 1;
  });
  const observations = trace.observations || [];
  const agent = observations.find((item) => item.name === "agent.vistaar") || {};
  const metadata = trace.metadata || {};
  const tags = trace.tags || [];
  const modelTag = tags.find((tag) => String(tag).startsWith("model:"));
  const evaluatedAt = overall?.timestamp || overall?.createdAt || new Date().toISOString();

  return {
    complete: missing.length === 0,
    missing,
    item: {
      qid: metadata.qid || null,
      masked_session_ref: null,
      question: textValue(trace.input),
      answer: textValue(trace.output) || textValue(agent.output),
      category: String(scoreValue(category) || "Unknown"),
      agristack_required: String(scoreValue(agristack) || "No"),
      target_lang: metadata.target_lang || null,
      serving_model: modelTag ? modelTag.split(":", 2)[1] : metadata.serving_model || null,
      application_release: metadata.application_release || null,
      selection_source: manifest.selection_source,
      feedback_types: manifest.feedback_types || [],
      feedback_count: manifest.feedback_count || 0,
      feedback_comment_present: Boolean(manifest.feedback_comment_present),
      evaluation: {
        summary: overall?.comment || "Evaluation synchronized from Langfuse",
        dimensions,
        metrics: {
          overall_average: overall ? Number(scoreValue(overall)) : null,
          overall_pass: pass ? booleanScoreValue(pass) : criticalFailures.length === 0,
          critical_failures: criticalFailures,
          critical_failure_count: criticalFailures.length,
        },
      },
      evaluated_at: evaluatedAt,
    },
  };
}

function createLangfuseClient() {
  const host = (process.env.LANGFUSE_HOST || process.env.LANGFUSE_BASE_URL || "").replace(/\/$/, "");
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!host || !publicKey || !secretKey) throw new Error("Langfuse synchronization is not configured");
  return axios.create({ baseURL: host, auth: { username: publicKey, password: secretKey }, timeout: 60000 });
}

async function findRunScoredManifestEntries(client, runId, manifestRows) {
  const expected = new Map(
    manifestRows.map((row) => [scoreId(runId, row.trace_id, `${RUBRIC_PREFIX}.overall`), row])
  );
  const scored = new Map();
  let page = 1;

  while (scored.size < expected.size) {
    const response = await client.get("/api/public/scores", {
      params: { name: `${RUBRIC_PREFIX}.overall`, limit: 100, page },
    });
    const scores = response.data?.data || [];
    for (const entry of scores) {
      const row = expected.get(entry.id);
      if (row) scored.set(row.trace_id, row);
    }

    const totalPages = Number(response.data?.meta?.totalPages || response.data?.meta?.total_pages || page);
    if (!scores.length || page >= totalPages) break;
    page += 1;
  }

  return [...scored.values()];
}

module.exports = {
  DIMENSIONS, RUBRIC_PREFIX, SCORE_NAMESPACE, scoreId, normalizeTraceScores, createLangfuseClient,
  findRunScoredManifestEntries,
};
