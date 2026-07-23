const { randomUUID } = require("node:crypto");
const pool = require("./db");
const { ensureEvaluationSchema } = require("./evaluationSchema");
const evaluationWorker = require("./evaluationWorkerClient");
const { decryptSecret } = require("./evaluationCredentials");

const clamp = (value, min, max) => Math.min(Math.max(Number(value), min), max);
const supportedLanguages = new Set(["mr", "hi", "en", "bhb"]);
const normalizeLanguages = (value) => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("Target languages must be an array of language codes");
  const languages = [...new Set(value.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
  if (!languages.length || languages.some((item) => !supportedLanguages.has(item))) {
    throw new Error("Target languages must contain one or more of: mr, hi, en, bhb");
  }
  return languages;
};

async function launchEvaluationRun({
  state = "bharat-vistaar", requestedBy = "admin", endpointId,
  populationLimit = 1000, samplingMode = "percent", samplingValue = 10,
  targetLanguages = [],
}) {
  await ensureEvaluationSchema();
  if (!endpointId) throw new Error("A judge endpoint is required");
  if (!["percent", "count"].includes(samplingMode)) throw new Error("Sampling mode must be percent or count");
  const languages = normalizeLanguages(targetLanguages);
  const endpointResult = await pool.query(
    "SELECT * FROM evaluation_judge_endpoints WHERE id=$1 AND enabled=TRUE",
    [endpointId]
  );
  if (!endpointResult.rowCount) throw new Error("Judge endpoint not found or disabled");
  const endpoint = endpointResult.rows[0];
  const population = Math.round(clamp(populationLimit || 1000, 10, 100000));
  const selectionValue = samplingMode === "percent"
    ? clamp(samplingValue || 10, 0.01, 100)
    : Math.round(clamp(samplingValue || 1, 1, population));
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").replace(/\..+/, "");
  const runId = `mh-eval-${stamp}-${randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  await pool.query(`
    INSERT INTO evaluation_runs (
      run_id, state, window_start, window_end, status, judge_model, schema_version,
      rubric_version, requested_by, judge_endpoint_id, sampling_mode, sampling_value, target_languages
    ) VALUES ($1,$2,$3,$3,'running',$4,'evaluation-item-v1','mh-production-v1',$5,$6,$7,$8,$9::jsonb)
  `, [runId, state, now, endpoint.default_model, requestedBy, endpoint.id, samplingMode, selectionValue, JSON.stringify(languages)]);
  try {
    const workerRun = await evaluationWorker.startRun({
      run_id: runId,
      model: endpoint.default_model,
      judge_base_url: endpoint.base_url,
      judge_api_key: decryptSecret(endpoint.api_key_cipher),
      provider_type: endpoint.provider_type,
      population_limit: population,
      sampling_mode: samplingMode,
      sampling_value: selectionValue,
      target_languages: languages,
      state,
      requested_by: requestedBy,
    });
    return workerRun;
  } catch (error) {
    const message = String(error.response?.data?.detail || error.message).slice(0, 4000);
    await pool.query(
      "UPDATE evaluation_runs SET status='failed', error=$2, completed_at=NOW(), updated_at=NOW() WHERE run_id=$1",
      [runId, message]
    );
    throw error;
  }
}

module.exports = { launchEvaluationRun };
