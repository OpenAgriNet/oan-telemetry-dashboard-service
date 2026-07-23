const pool = require("../services/db");
const { ensureEvaluationSchema } = require("../services/evaluationSchema");
const evaluationWorker = require("../services/evaluationWorkerClient");
const { launchEvaluationRun } = require("../services/evaluationRunLauncher");
const {
  createLangfuseClient, normalizeTraceScores, findRunScoredManifestEntries,
} = require("../services/langfuseEvaluationSync");

const stateFrom = (req) => req.get("x-telemetry-state") || "bharat-vistaar";
const intParam = (value, fallback, max = 100) => Math.min(Math.max(parseInt(value, 10) || fallback, 1), max);

async function refreshRunProgress(runId) {
  const progress = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'synced')::int AS successful,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM evaluation_run_traces WHERE run_id = $1
  `, [runId]);
  const { total, successful, failed } = progress.rows[0];
  const finished = total > 0 && successful + failed >= total;
  const status = finished ? (failed > 0 ? "partial" : "complete") : "running";
  await pool.query(`
    UPDATE evaluation_runs SET status=$2, successful_count=$3, failed_count=$4,
      score_source='langfuse', last_synced_at=NOW(),
      completed_at=CASE WHEN $5 THEN NOW() ELSE completed_at END, updated_at=NOW()
    WHERE run_id=$1
  `, [runId, status, successful, failed, finished]);
  return { run_id: runId, status, total, successful, failed };
}

async function persistEvaluationItem(runId, traceId, b) {
  const metrics = b.evaluation?.metrics || {};
  const dimensions = b.evaluation?.dimensions || {};
  const dimensionAverages = Object.fromEntries(
    Object.entries(dimensions).map(([key, value]) => [key, value?.average ?? null])
  );
  const values = [
    runId, traceId, b.qid || null, b.masked_session_ref || null,
    b.question || "", b.answer || "", b.category || "Unknown", b.agristack_required || "No",
    b.target_lang || null, b.serving_model || null, b.application_release || null,
    b.selection_source, JSON.stringify(b.feedback_types || []), b.feedback_count || 0,
    Boolean(b.feedback_comment_present), JSON.stringify(b.evaluation), JSON.stringify(dimensionAverages),
    metrics.overall_average ?? null, Boolean(metrics.overall_pass), JSON.stringify(metrics.critical_failures || []),
    b.evaluated_at || new Date().toISOString(),
  ];
  return pool.query(`
    INSERT INTO evaluation_items (
      run_id, trace_id, qid, masked_session_ref, question, answer, category,
      agristack_required, target_lang, serving_model, application_release, selection_source,
      feedback_types, feedback_count, feedback_comment_present, evaluation, dimension_averages,
      overall_average, overall_pass, critical_failures, evaluated_at
    ) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")})
    ON CONFLICT (run_id, trace_id) DO UPDATE SET
      qid = EXCLUDED.qid, question = EXCLUDED.question, answer = EXCLUDED.answer,
      category = EXCLUDED.category, agristack_required = EXCLUDED.agristack_required,
      target_lang = EXCLUDED.target_lang, serving_model = EXCLUDED.serving_model,
      application_release = EXCLUDED.application_release, selection_source = EXCLUDED.selection_source,
      evaluation = EXCLUDED.evaluation, dimension_averages = EXCLUDED.dimension_averages,
      overall_average = EXCLUDED.overall_average, overall_pass = EXCLUDED.overall_pass,
      critical_failures = EXCLUDED.critical_failures, feedback_types = EXCLUDED.feedback_types,
      feedback_count = EXCLUDED.feedback_count, feedback_comment_present = EXCLUDED.feedback_comment_present,
      evaluated_at = EXCLUDED.evaluated_at
    RETURNING id, run_id, trace_id
  `, values);
}

async function upsertRun(req, res) {
  try {
    await ensureEvaluationSchema();
    const runId = req.params.runId;
    const b = req.body || {};
    const values = [
      runId, b.state || "bharat-vistaar", b.window_start, b.window_end, b.status || "running",
      b.population_count || 0, b.random_target || 0, b.feedback_selected_count || 0,
      b.random_selected_count || 0, b.unmatched_feedback_count || 0, b.successful_count || 0,
      b.failed_count || 0, b.judge_model, b.schema_version, b.rubric_version, b.completed_at || null,
      b.requested_by || null, b.error || null, JSON.stringify(b.target_languages || []),
    ];
    const result = await pool.query(`
      INSERT INTO evaluation_runs (
        run_id, state, window_start, window_end, status, population_count, random_target,
        feedback_selected_count, random_selected_count, unmatched_feedback_count,
        successful_count, failed_count, judge_model, schema_version, rubric_version, completed_at,
        requested_by, error, target_languages
      ) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")})
      ON CONFLICT (run_id) DO UPDATE SET
        status = EXCLUDED.status, population_count = EXCLUDED.population_count,
        random_target = EXCLUDED.random_target, feedback_selected_count = EXCLUDED.feedback_selected_count,
        random_selected_count = EXCLUDED.random_selected_count,
        unmatched_feedback_count = EXCLUDED.unmatched_feedback_count,
        successful_count = EXCLUDED.successful_count, failed_count = EXCLUDED.failed_count,
        state = EXCLUDED.state, window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end,
        judge_model = EXCLUDED.judge_model, schema_version = EXCLUDED.schema_version,
        rubric_version = EXCLUDED.rubric_version, requested_by = COALESCE(EXCLUDED.requested_by, evaluation_runs.requested_by),
        target_languages = EXCLUDED.target_languages,
        error = EXCLUDED.error, completed_at = EXCLUDED.completed_at, updated_at = NOW()
      RETURNING *
    `, values);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("evaluation run upsert failed", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function upsertItem(req, res) {
  try {
    await ensureEvaluationSchema();
    const result = await persistEvaluationItem(req.params.runId, req.params.traceId, req.body || {});
    await pool.query(`UPDATE evaluation_run_traces SET status='synced', error=NULL, scored_at=COALESCE(scored_at, NOW()), synced_at=NOW(), updated_at=NOW() WHERE run_id=$1 AND trace_id=$2`, [req.params.runId, req.params.traceId]);
    const progress = await refreshRunProgress(req.params.runId);
    res.json({ success: true, data: { ...result.rows[0], progress } });
  } catch (error) {
    console.error("evaluation item upsert failed", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function updateTraceStatus(req, res) {
  try {
    await ensureEvaluationSchema();
    const status = req.body?.status;
    if (!['pending', 'scored', 'failed'].includes(status)) {
      return res.status(400).json({ success: false, message: "Unsupported trace status" });
    }
    const result = await pool.query(`
      UPDATE evaluation_run_traces SET status=$3, error=$4, updated_at=NOW()
      WHERE run_id=$1 AND trace_id=$2 RETURNING run_id, trace_id, status, error
    `, [req.params.runId, req.params.traceId, status, req.body?.error || null]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Run trace not found" });
    const progress = await refreshRunProgress(req.params.runId);
    res.json({ success: true, data: { ...result.rows[0], progress } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function listJudgeModels(req, res) {
  try {
    res.json({ success: true, data: await evaluationWorker.listModels() });
  } catch (error) {
    const status = error.response?.status || 503;
    res.status(status).json({ success: false, message: error.response?.data?.detail || error.message });
  }
}

async function startRun(req, res) {
  try {
    const requestedBy = String(req.user?.preferred_username || req.user?.email || req.user?.sub || "admin").slice(0, 255);
    const data = await launchEvaluationRun({
      state: stateFrom(req),
      requestedBy,
      endpointId: req.body?.judge_endpoint_id,
      populationLimit: req.body?.population_limit,
      samplingMode: req.body?.sampling_mode,
      samplingValue: req.body?.sampling_value,
      targetLanguages: req.body?.target_languages,
    });
    res.status(202).json({ success: true, data });
  } catch (error) {
    const status = error.response?.status || 503;
    res.status(status).json({ success: false, message: error.response?.data?.detail || error.message });
  }
}

async function upsertManifest(req, res) {
  const client = await pool.connect();
  try {
    await ensureEvaluationSchema();
    const traces = Array.isArray(req.body?.traces) ? req.body.traces : [];
    if (!traces.length || traces.some((item) => !item.trace_id || !["feedback", "random"].includes(item.selection_source))) {
      return res.status(400).json({ success: false, message: "traces must contain trace_id and a valid selection_source" });
    }
    const run = await pool.query("SELECT run_id FROM evaluation_runs WHERE run_id = $1", [req.params.runId]);
    if (!run.rowCount) return res.status(404).json({ success: false, message: "Run not found" });
    const existing = await pool.query("SELECT trace_id FROM evaluation_run_traces WHERE run_id = $1 ORDER BY trace_id", [req.params.runId]);
    const existingIds = existing.rows.map((row) => row.trace_id).sort();
    const requestedIds = [...new Set(traces.map((item) => item.trace_id))].sort();
    if (existingIds.length && JSON.stringify(existingIds) !== JSON.stringify(requestedIds)) {
      return res.status(409).json({ success: false, message: "Run manifests are immutable once registered" });
    }
    await client.query("BEGIN");
    for (const item of traces) {
      await client.query(`
        INSERT INTO evaluation_run_traces (
          run_id, trace_id, selection_source, feedback_types, feedback_count, feedback_comment_present
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        ON CONFLICT (run_id, trace_id) DO UPDATE SET
          selection_source = EXCLUDED.selection_source, feedback_types = EXCLUDED.feedback_types,
          feedback_count = EXCLUDED.feedback_count,
          feedback_comment_present = EXCLUDED.feedback_comment_present, updated_at = NOW()
      `, [req.params.runId, item.trace_id, item.selection_source, JSON.stringify(item.feedback_types || []), item.feedback_count || 0, Boolean(item.feedback_comment_present)]);
    }
    await client.query("COMMIT");
    res.json({ success: true, data: { run_id: req.params.runId, trace_count: traces.length } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ success: false, message: error.message });
  } finally { client.release(); }
}

async function getManifest(req, res) {
  try {
    await ensureEvaluationSchema();
    const run = await pool.query("SELECT * FROM evaluation_runs WHERE run_id = $1", [req.params.runId]);
    if (!run.rowCount) return res.status(404).json({ success: false, message: "Run not found" });
    const traces = await pool.query(`
      SELECT trace_id, selection_source, feedback_types, feedback_count, feedback_comment_present,
             status, error, scored_at, synced_at
      FROM evaluation_run_traces WHERE run_id = $1 ORDER BY created_at, trace_id
    `, [req.params.runId]);
    res.json({ success: true, data: { run: run.rows[0], traces: traces.rows } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

async function syncRunFromLangfuse(req, res) {
  try {
    await ensureEvaluationSchema();
    const manifest = await pool.query("SELECT * FROM evaluation_run_traces WHERE run_id = $1 ORDER BY trace_id", [req.params.runId]);
    if (!manifest.rowCount) return res.status(404).json({ success: false, message: "Run manifest not found" });
    const langfuse = createLangfuseClient();
    let synced = 0;
    const failures = [];
    const scoredRows = await findRunScoredManifestEntries(langfuse, req.params.runId, manifest.rows);
    let cursor = 0;
    const syncNext = async () => {
      const row = scoredRows[cursor++];
      if (!row) return;
      try {
        const response = await langfuse.get(`/api/public/traces/${encodeURIComponent(row.trace_id)}`);
        const normalized = normalizeTraceScores(req.params.runId, response.data, row);
        if (!normalized.complete) throw new Error(`Missing scores: ${normalized.missing.join(", ")}`);
        await persistEvaluationItem(req.params.runId, row.trace_id, normalized.item);
        await pool.query(`UPDATE evaluation_run_traces SET status='synced', error=NULL, scored_at=COALESCE(scored_at, $3), synced_at=NOW(), updated_at=NOW() WHERE run_id=$1 AND trace_id=$2`, [req.params.runId, row.trace_id, normalized.item.evaluated_at]);
        synced += 1;
      } catch (error) {
        failures.push({ trace_id: row.trace_id, error: error.message });
        await pool.query(`UPDATE evaluation_run_traces SET status='failed', error=$3, updated_at=NOW() WHERE run_id=$1 AND trace_id=$2`, [req.params.runId, row.trace_id, String(error.message).slice(0, 4000)]);
      }
      await syncNext();
    };
    await Promise.all(Array.from({ length: Math.min(4, scoredRows.length) }, syncNext));
    const pending = manifest.rowCount - synced - failures.length;
    const status = pending === 0 && failures.length === 0 ? "complete" : (synced || failures.length ? "partial" : "running");
    await pool.query(`UPDATE evaluation_runs SET status=$2, successful_count=$3, failed_count=$4, score_source='langfuse', last_synced_at=NOW(), completed_at=CASE WHEN status IN ('complete','partial') THEN NOW() ELSE completed_at END, updated_at=NOW() WHERE run_id=$1`, [req.params.runId, status, synced, failures.length]);
    res.status(failures.length && !synced ? 502 : 200).json({ success: synced > 0 || !failures.length, data: { run_id: req.params.runId, status, synced, failed: failures.length, pending, failures } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

async function getFeedbackCandidates(req, res) {
  try {
    await ensureEvaluationSchema();
    const startMs = Number(req.query.start_ms);
    const endMs = Number(req.query.end_ms);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return res.status(400).json({ success: false, message: "Valid start_ms and end_ms are required" });
    }
    const result = await pool.query(`
      SELECT qid, MIN(sid) AS session_id, MIN(questiontext) AS question,
             MIN(answertext) AS answer, ARRAY_AGG(DISTINCT LOWER(feedbacktype)) AS feedback_types,
             COUNT(*)::int AS feedback_count,
             BOOL_OR(NULLIF(TRIM(feedbacktext), '') IS NOT NULL) AS feedback_comment_present
      FROM feedback
      WHERE ets >= $1 AND ets < $2 AND qid IS NOT NULL AND qid <> ''
      GROUP BY qid
      ORDER BY qid
    `, [startMs, endMs]);
    const unmatched = await pool.query(`
      SELECT COUNT(*)::int AS count FROM feedback
      WHERE ets >= $1 AND ets < $2 AND (qid IS NULL OR qid = '')
    `, [startMs, endMs]);
    res.json({ success: true, data: result.rows, unmatched_count: unmatched.rows[0].count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function listRuns(req, res) {
  try {
    await ensureEvaluationSchema();
    const result = await pool.query(`
      SELECT * FROM evaluation_runs WHERE state = $1 ORDER BY window_end DESC LIMIT 180
    `, [stateFrom(req)]);
    res.json({ success: true, data: result.rows });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

async function getSummary(req, res) {
  try {
    await ensureEvaluationSchema();
    const run = await pool.query("SELECT * FROM evaluation_runs WHERE run_id = $1 AND state = $2", [req.params.runId, stateFrom(req)]);
    if (!run.rowCount) return res.status(404).json({ success: false, message: "Run not found" });
    const stats = await pool.query(`
      SELECT COUNT(*)::int AS evaluated_count,
             COUNT(*) FILTER (WHERE overall_pass)::int AS passed_count,
             COUNT(*) FILTER (WHERE NOT overall_pass)::int AS critical_failure_count,
             AVG(overall_average)::float AS overall_average,
             AVG((dimension_averages->>'process_fidelity')::numeric)::float AS process_fidelity,
             AVG((dimension_averages->>'factual_grounding')::numeric)::float AS factual_grounding,
             AVG((dimension_averages->>'response_usefulness')::numeric)::float AS response_usefulness,
             AVG((dimension_averages->>'marathi_quality')::numeric)::float AS marathi_quality
      FROM evaluation_items WHERE run_id = $1
    `, [req.params.runId]);
    const evaluations = await pool.query("SELECT evaluation FROM evaluation_items WHERE run_id = $1", [req.params.runId]);
    const metricValues = {};
    for (const row of evaluations.rows) {
      for (const [dimensionName, dimension] of Object.entries(row.evaluation?.dimensions || {})) {
        for (const [metricName, metric] of Object.entries(dimension?.scores || {})) {
          if (typeof metric?.score === "number") {
            const key = `${dimensionName}.${metricName}`;
            (metricValues[key] ||= []).push(metric.score);
          }
        }
      }
    }
    const metric_averages = Object.fromEntries(
      Object.entries(metricValues).map(([key, values]) => [key, values.reduce((sum, value) => sum + value, 0) / values.length])
    );
    res.json({ success: true, data: { run: run.rows[0], ...stats.rows[0], metric_averages } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

async function listItems(req, res) {
  try {
    await ensureEvaluationSchema();
    const page = intParam(req.query.page, 1, 100000);
    const limit = intParam(req.query.limit, 20, 100);
    const conditions = ["i.run_id = $1", "r.state = $2"];
    const params = [req.params.runId, stateFrom(req)];
    const add = (clause, value) => { params.push(value); conditions.push(clause.replace("?", `$${params.length}`)); };
    if (req.query.category) add("i.category = ?", req.query.category);
    if (req.query.selection_source) add("i.selection_source = ?", req.query.selection_source);
    if (req.query.agristack_required) add("i.agristack_required = ?", req.query.agristack_required);
    if (req.query.target_lang) add("i.target_lang = ?", req.query.target_lang);
    if (req.query.serving_model) add("i.serving_model = ?", req.query.serving_model);
    if (req.query.application_release) add("i.application_release = ?", req.query.application_release);
    if (req.query.feedback_type) add("i.feedback_types @> ?::jsonb", JSON.stringify([req.query.feedback_type.toLowerCase()]));
    if (req.query.critical_only === "true") conditions.push("i.overall_pass = FALSE");
    const where = conditions.join(" AND ");
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM evaluation_items i JOIN evaluation_runs r ON r.run_id=i.run_id WHERE ${where}`, params);
    params.push(limit, (page - 1) * limit);
    const result = await pool.query(`
      SELECT i.id, i.run_id, i.trace_id, i.qid, i.question, i.category, i.agristack_required,
             i.target_lang, i.serving_model, i.application_release, i.selection_source,
             i.feedback_types, i.feedback_count, i.overall_average, i.overall_pass,
             i.critical_failures, i.evaluated_at
      FROM evaluation_items i JOIN evaluation_runs r ON r.run_id=i.run_id
      WHERE ${where} ORDER BY i.evaluated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    res.json({ success: true, data: result.rows, pagination: { page, limit, total: count.rows[0].total, totalPages: Math.ceil(count.rows[0].total / limit) } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

async function getItem(req, res) {
  try {
    await ensureEvaluationSchema();
    const result = await pool.query(`
      SELECT i.* FROM evaluation_items i JOIN evaluation_runs r ON r.run_id=i.run_id
      WHERE i.id = $1 AND i.run_id = $2 AND r.state = $3
    `, [req.params.itemId, req.params.runId, stateFrom(req)]);
    if (!result.rowCount) return res.status(404).json({ success: false, message: "Evaluation not found" });
    const comments = await pool.query(`
      SELECT id, author, comment, created_at
      FROM evaluation_comments
      WHERE item_id = $1
      ORDER BY created_at DESC
    `, [req.params.itemId]);
    res.json({ success: true, data: { ...result.rows[0], comments: comments.rows } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

async function addComment(req, res) {
  try {
    await ensureEvaluationSchema();
    const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
    if (!comment || comment.length > 2000) {
      return res.status(400).json({ success: false, message: "Comment must be between 1 and 2000 characters" });
    }
    const item = await pool.query(`
      SELECT i.id FROM evaluation_items i
      JOIN evaluation_runs r ON r.run_id = i.run_id
      WHERE i.id = $1 AND i.run_id = $2 AND r.state = $3
    `, [req.params.itemId, req.params.runId, stateFrom(req)]);
    if (!item.rowCount) return res.status(404).json({ success: false, message: "Evaluation not found" });

    const author = String(
      req.user?.preferred_username || req.user?.email || req.user?.sub || "evaluator"
    ).slice(0, 255);
    const result = await pool.query(`
      INSERT INTO evaluation_comments (item_id, author, comment)
      VALUES ($1, $2, $3)
      RETURNING id, author, comment, created_at
    `, [req.params.itemId, author, comment]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

module.exports = { upsertRun, upsertItem, updateTraceStatus, upsertManifest, getManifest, syncRunFromLangfuse, getFeedbackCandidates, listJudgeModels, startRun, listRuns, getSummary, listItems, getItem, addComment };
