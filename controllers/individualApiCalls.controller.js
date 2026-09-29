const pool = require("../services/db");
const { parseDateRange } = require("../utils/dateUtils");

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function dateFilter(startTimestamp, endTimestamp, values) {
  const clauses = [];
  if (startTimestamp !== null) {
    values.push(new Date(startTimestamp));
    clauses.push(`event_time >= $${values.length}`);
  }
  if (endTimestamp !== null) {
    values.push(new Date(endTimestamp));
    clauses.push(`event_time <= $${values.length}`);
  }
  return clauses;
}

function eventFilters({ startTimestamp, endTimestamp, outcome, layer, service, search }, values) {
  const clauses = [
    "trace_scope = 'beckn_external_api'",
    "NULLIF(TRIM(COALESCE(endpoint, '')), '') IS NOT NULL",
  ];

  clauses.push(...dateFilter(startTimestamp, endTimestamp, values));

  if (outcome === "success" || outcome === "failure") {
    values.push(outcome);
    clauses.push(`outcome = $${values.length}`);
  }
  if (layer) {
    values.push(layer);
    clauses.push(`layer = $${values.length}`);
  }
  if (service) {
    values.push(service);
    clauses.push(`service = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(
      endpoint ILIKE $${values.length}
      OR service ILIKE $${values.length}
      OR event_name ILIKE $${values.length}
      OR method ILIKE $${values.length}
    )`);
  }
  return clauses;
}

function getDateRange(req, res) {
  const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
  const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
    res.status(400).json({ success: false, error: "Invalid date format" });
    return null;
  }
  if (startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp) {
    res.status(400).json({ success: false, error: "Start date must be before end date" });
    return null;
  }
  return { startDate, endDate, startTimestamp, endTimestamp };
}

function noTablesResponse(res, filters) {
  return res.status(200).json({
    success: true,
    data: { calls: [], summary: { total: 0, successful: 0, failed: 0 }, filterOptions: { layers: [], services: [] } },
    pagination: { page: 1, limit: DEFAULT_LIMIT, total: 0, totalPages: 0 },
    filters,
    warning: "External telemetry tables are not available yet.",
  });
}

async function getIndividualApiCalls(req, res) {
  const range = getDateRange(req, res);
  if (!range) return;

  const page = parsePositiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
  const limit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const outcome = String(req.query.outcome || "").trim().toLowerCase();
  const layer = String(req.query.layer || "").trim();
  const service = String(req.query.service || "").trim();
  const search = String(req.query.search || "").trim().slice(0, 200);
  const requestFilters = { ...range, outcome, layer, service, search };
  const values = [];
  const where = eventFilters(requestFilters, values).join(" AND ");

  try {
    const countQuery = {
      text: `
        SELECT
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE outcome = 'success')::integer AS successful,
          COUNT(*) FILTER (WHERE outcome = 'failure')::integer AS failed
        FROM external_api_events
        WHERE ${where}
      `,
      values,
    };
    const callValues = [...values, limit, (page - 1) * limit];
    const callsQuery = {
      text: `
        SELECT
          id, event_mid, trace_id, event_name, layer, service, dependency,
          method, endpoint, outcome, http_status, response_status, error_payload,
          event_time, duration_ms, request_payload IS NOT NULL AS has_request_payload,
          response_payload IS NOT NULL AS has_response_payload,
          error_payload IS NOT NULL AS has_error_payload
        FROM external_api_events
        WHERE ${where}
        ORDER BY event_time DESC NULLS LAST, id DESC
        LIMIT $${callValues.length - 1} OFFSET $${callValues.length}
      `,
      values: callValues,
    };
    const optionValues = [];
    const optionWhere = eventFilters({ ...range, outcome: "", layer: "", service: "", search: "" }, optionValues).join(" AND ");
    const optionsQuery = {
      text: `
        SELECT
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT layer ORDER BY layer), NULL) AS layers,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT service ORDER BY service), NULL) AS services
        FROM external_api_events
        WHERE ${optionWhere}
      `,
      values: optionValues,
    };

    const [countResult, callsResult, optionsResult] = await Promise.all([
      pool.query(countQuery),
      pool.query(callsQuery),
      pool.query(optionsQuery),
    ]);
    const summary = countResult.rows[0];
    const total = summary.total || 0;

    return res.status(200).json({
      success: true,
      data: {
        calls: callsResult.rows,
        summary: { total, successful: summary.successful || 0, failed: summary.failed || 0 },
        filterOptions: {
          layers: optionsResult.rows[0]?.layers || [],
          services: optionsResult.rows[0]?.services || [],
        },
      },
      pagination: { page, limit, total, totalPages: total ? Math.ceil(total / limit) : 0 },
      filters: { startDate: range.startDate, endDate: range.endDate, outcome: outcome || null, layer: layer || null, service: service || null, search: search || null },
    });
  } catch (error) {
    if (error.code === "42P01") return noTablesResponse(res, range);
    console.error("Error fetching individual API calls:", error);
    return res.status(500).json({ success: false, error: "Error fetching individual API calls" });
  }
}

async function getIndividualApiCall(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ success: false, error: "Invalid API call identifier" });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          id, event_mid, trace_id, event_name, layer, service, dependency,
          stage, action, method, endpoint, outcome, http_status, response_status,
          error_payload, event_time, request_started_at, response_received_at,
          duration_ms, request_payload, response_payload, request_payload_bytes,
          response_payload_bytes, response_payload_truncated, question_id, session_id,
          transaction_id, message_id, http_call_id, dependency_operation_id
        FROM external_api_events
        WHERE id = $1
          AND trace_scope = 'beckn_external_api'
          AND NULLIF(TRIM(COALESCE(endpoint, '')), '') IS NOT NULL
      `,
      [id],
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: "API call not found" });
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error.code === "42P01") return noTablesResponse(res, {});
    console.error("Error fetching individual API call:", error);
    return res.status(500).json({ success: false, error: "Error fetching individual API call" });
  }
}

module.exports = { getIndividualApiCalls, getIndividualApiCall, eventFilters };
