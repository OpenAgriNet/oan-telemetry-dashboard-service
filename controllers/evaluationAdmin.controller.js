const axios = require("axios");
const pool = require("../services/db");
const { ensureEvaluationSchema } = require("../services/evaluationSchema");
const { encryptSecret, decryptSecret } = require("../services/evaluationCredentials");

const providers = new Set(["openai", "vllm", "cerebras", "openai_compatible"]);
const actor = (req) => String(req.user?.preferred_username || req.user?.email || req.user?.sub || "admin").slice(0, 255);

function endpointInput(body, { partial = false } = {}) {
  const output = {};
  if (!partial || body.name !== undefined) {
    output.name = String(body.name || "").trim().slice(0, 120);
    if (!output.name) throw new Error("Endpoint name is required");
  }
  if (!partial || body.provider_type !== undefined) {
    output.provider_type = String(body.provider_type || "");
    if (!providers.has(output.provider_type)) throw new Error("Unsupported provider type");
  }
  if (!partial || body.base_url !== undefined) {
    const parsed = new URL(String(body.base_url || ""));
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Endpoint URL must use HTTP or HTTPS");
    const allowlist = String(process.env.EVALUATION_JUDGE_ALLOWED_HOSTS || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (allowlist.length && !allowlist.includes(parsed.hostname)) throw new Error("Endpoint host is not in EVALUATION_JUDGE_ALLOWED_HOSTS");
    output.base_url = parsed.toString().replace(/\/$/, "");
  }
  if (!partial || body.default_model !== undefined) {
    output.default_model = String(body.default_model || "").trim().slice(0, 255);
    if (!output.default_model) throw new Error("Model ID is required");
  }
  if (body.api_key) output.api_key_cipher = encryptSecret(String(body.api_key));
  if (body.enabled !== undefined) output.enabled = Boolean(body.enabled);
  return output;
}

const publicEndpoint = (row) => ({
  id: row.id, name: row.name, provider_type: row.provider_type, base_url: row.base_url,
  default_model: row.default_model, enabled: row.enabled, has_api_key: Boolean(row.api_key_cipher),
  created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at,
});

async function listEndpoints(req, res) {
  try {
    await ensureEvaluationSchema();
    const result = await pool.query("SELECT * FROM evaluation_judge_endpoints ORDER BY enabled DESC, name");
    res.json({ success: true, data: result.rows.map(publicEndpoint) });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

async function createEndpoint(req, res) {
  try {
    await ensureEvaluationSchema();
    const input = endpointInput(req.body || {});
    const result = await pool.query(`
      INSERT INTO evaluation_judge_endpoints
        (name, provider_type, base_url, default_model, api_key_cipher, enabled, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [input.name, input.provider_type, input.base_url, input.default_model, input.api_key_cipher || null, input.enabled ?? true, actor(req)]);
    res.status(201).json({ success: true, data: publicEndpoint(result.rows[0]) });
  } catch (error) {
    const status = error.code === "23505" ? 409 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function updateEndpoint(req, res) {
  try {
    await ensureEvaluationSchema();
    const input = endpointInput(req.body || {}, { partial: true });
    const fields = Object.keys(input);
    if (!fields.length) return res.status(400).json({ success: false, message: "No endpoint changes supplied" });
    const values = fields.map((field) => input[field]);
    values.push(req.params.endpointId);
    const result = await pool.query(`UPDATE evaluation_judge_endpoints SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(", ")}, updated_at=NOW() WHERE id=$${values.length} RETURNING *`, values);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Endpoint not found" });
    res.json({ success: true, data: publicEndpoint(result.rows[0]) });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
}

async function disableEndpoint(req, res) {
  try {
    await ensureEvaluationSchema();
    const result = await pool.query("UPDATE evaluation_judge_endpoints SET enabled=FALSE, updated_at=NOW() WHERE id=$1 RETURNING id", [req.params.endpointId]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Endpoint not found" });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

async function testEndpoint(req, res) {
  try {
    await ensureEvaluationSchema();
    const result = await pool.query("SELECT * FROM evaluation_judge_endpoints WHERE id=$1", [req.params.endpointId]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Endpoint not found" });
    const endpoint = result.rows[0];
    const apiKey = decryptSecret(endpoint.api_key_cipher);
    const response = await axios.get(`${endpoint.base_url}/models`, {
      timeout: 12000,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    const models = Array.isArray(response.data?.data) ? response.data.data.map((item) => item.id).filter(Boolean).slice(0, 50) : [];
    res.json({ success: true, data: { reachable: true, models, configured_model_present: models.includes(endpoint.default_model) } });
  } catch (error) {
    res.status(502).json({ success: false, message: error.response?.data?.error?.message || error.message });
  }
}

function scheduleInput(body) {
  const samplingMode = String(body.sampling_mode || "percent");
  const samplingValue = Number(body.sampling_value);
  const populationLimit = Number(body.population_limit);
  const dailyHour = Number(body.daily_hour_ist);
  const targetLanguages = Array.isArray(body.target_languages)
    ? [...new Set(body.target_languages.map((item) => String(item).trim().toLowerCase()).filter(Boolean))]
    : [];
  if (!["percent", "count"].includes(samplingMode)) throw new Error("Sampling mode must be percent or count");
  if (!Number.isFinite(samplingValue) || samplingValue <= 0 || (samplingMode === "percent" && samplingValue > 100)) throw new Error("Invalid sampling value");
  if (!Number.isInteger(populationLimit) || populationLimit < 10 || populationLimit > 100000) throw new Error("Population must be between 10 and 100000");
  if (!Number.isInteger(dailyHour) || dailyHour < 0 || dailyHour > 23) throw new Error("Daily hour must be between 0 and 23 IST");
  if (!targetLanguages.length || targetLanguages.some((item) => !["mr", "hi", "en", "bhb"].includes(item))) throw new Error("Target languages must contain one or more of: mr, hi, en, bhb");
  return {
    name: String(body.name || "Daily evaluation").trim().slice(0, 120),
    judge_endpoint_id: String(body.judge_endpoint_id || ""), population_limit: populationLimit,
    sampling_mode: samplingMode, sampling_value: samplingValue, daily_hour_ist: dailyHour,
    target_languages: targetLanguages,
    enabled: body.enabled !== false,
  };
}

async function listSchedules(req, res) {
  try {
    await ensureEvaluationSchema();
    const result = await pool.query(`SELECT s.*, e.name AS endpoint_name, e.default_model
      FROM evaluation_schedules s JOIN evaluation_judge_endpoints e ON e.id=s.judge_endpoint_id
      ORDER BY s.enabled DESC, s.daily_hour_ist, s.name`);
    res.json({ success: true, data: result.rows });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

async function createSchedule(req, res) {
  try {
    await ensureEvaluationSchema();
    const input = scheduleInput(req.body || {});
    const result = await pool.query(`INSERT INTO evaluation_schedules
      (name, judge_endpoint_id, population_limit, sampling_mode, sampling_value, target_languages, daily_hour_ist, enabled, created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING *`,
    [input.name, input.judge_endpoint_id, input.population_limit, input.sampling_mode, input.sampling_value, JSON.stringify(input.target_languages), input.daily_hour_ist, input.enabled, actor(req)]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
}

async function updateSchedule(req, res) {
  try {
    await ensureEvaluationSchema();
    const existing = await pool.query("SELECT * FROM evaluation_schedules WHERE id=$1", [req.params.scheduleId]);
    if (!existing.rowCount) return res.status(404).json({ success: false, message: "Schedule not found" });
    const input = scheduleInput({ ...existing.rows[0], ...(req.body || {}) });
    const result = await pool.query(`UPDATE evaluation_schedules SET name=$2, judge_endpoint_id=$3,
      population_limit=$4, sampling_mode=$5, sampling_value=$6, target_languages=$7::jsonb, daily_hour_ist=$8, enabled=$9,
      updated_at=NOW() WHERE id=$1 RETURNING *`,
    [req.params.scheduleId, input.name, input.judge_endpoint_id, input.population_limit, input.sampling_mode, input.sampling_value, JSON.stringify(input.target_languages), input.daily_hour_ist, input.enabled]);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
}

async function deleteSchedule(req, res) {
  try {
    await ensureEvaluationSchema();
    const result = await pool.query("DELETE FROM evaluation_schedules WHERE id=$1 RETURNING id", [req.params.scheduleId]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Schedule not found" });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

module.exports = { listEndpoints, createEndpoint, updateEndpoint, disableEndpoint, testEndpoint, listSchedules, createSchedule, updateSchedule, deleteSchedule };
