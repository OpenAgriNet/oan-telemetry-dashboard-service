const pool = require("../services/db");
const { parseDateRange } = require("../utils/dateUtils");

// provider_telemetry_events has no channel/state column, and its session_id /
// question_id values are the Beckn transaction_id / message_id (see
// request_payload.beckn), NOT questions.id or questions.sid — there is no
// reliable join back to `questions` to derive a channel. Per product
// confirmation, this data only ever belongs to the Bharat Vistaar state today,
// so we gate the whole feature on that state instead of filtering per-row.
const SUPPORTED_STATE_ID = "bharat-vistaar";

const EMPTY_SUMMARY = {
  totalEvents: 0,
  totalFlows: 0,
  uniqueSessions: 0,
  successCount: 0,
  extApiCallCount: 0,
  errorEventCount: 0,
  avgLatencyMs: null,
  maxLatencyMs: null,
  byService: [],
};

const emptyPagination = (page, limit) => ({
  currentPage: page,
  totalPages: 0,
  totalItems: 0,
  itemsPerPage: limit,
  hasNextPage: false,
  hasPreviousPage: false,
  nextPage: null,
  previousPage: null,
});

// GET /v1/provider-telemetry?state=&startDate=&endDate=&serviceName=&page=&limit=
// Single endpoint used for both the summary cards and the paginated log
// table on the External API Observability page — returns the aggregate
// summary (data.summary) and a page of flat, per-event rows (data.logs) in
// one response so the frontend only needs one request/refresh cycle.
const getProviderTelemetry = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const serviceName = req.query.serviceName ? String(req.query.serviceName).trim() : null;

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }
    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res.status(400).json({ success: false, error: "Start date cannot be after end date" });
    }

    const filters = {
      startDate,
      endDate,
      serviceName,
      appliedStartTimestamp: startTimestamp,
      appliedEndTimestamp: endTimestamp,
    };

    // Provider telemetry only exists for Bharat Vistaar today.
    if (telemetryState.id !== SUPPORTED_STATE_ID) {
      return res.status(200).json({
        success: true,
        data: { summary: EMPTY_SUMMARY, logs: [] },
        pagination: emptyPagination(page, limit),
        filters,
      });
    }

    const baseParams = [];
    let idx = 0;
    let dateFilter = "";

    if (startTimestamp !== null) {
      idx++;
      dateFilter += ` AND pte.event_timestamp >= to_timestamp($${idx}::bigint / 1000.0)`;
      baseParams.push(startTimestamp);
    }
    if (endTimestamp !== null) {
      idx++;
      dateFilter += ` AND pte.event_timestamp <= to_timestamp($${idx}::bigint / 1000.0)`;
      baseParams.push(endTimestamp);
    }

    let serviceFilter = "";
    if (serviceName) {
      idx++;
      serviceFilter = ` AND pte.service_name = $${idx}`;
      baseParams.push(serviceName);
    }

    const whereClause = `WHERE 1=1 ${dateFilter} ${serviceFilter}`;
    const listParams = [...baseParams, limit, offset];

    const [summaryResult, byServiceResult, listResult, countResult] = await Promise.all([
      pool.query(
        `
          SELECT
            COUNT(*) AS total_events,
            COUNT(DISTINCT pte.question_id) AS total_flows,
            COUNT(DISTINCT pte.session_id) AS unique_sessions,
            -- Every row is one API/flow-step call — success/error counts are
            -- taken across ALL rows (not just flow_end) so they add up to
            -- total_events, matching the log table's record count 1:1.
            COUNT(*) FILTER (WHERE pte.success = true) AS success_count,
            COUNT(*) FILTER (WHERE pte.success = false OR pte.event_type = 'error') AS error_event_count,
            COUNT(*) FILTER (WHERE pte.event_type = 'ext_api_call') AS ext_api_call_count,
            ROUND(AVG(pte.latency_ms) FILTER (WHERE pte.latency_ms IS NOT NULL)) AS avg_latency_ms,
            MAX(pte.latency_ms) AS max_latency_ms
          FROM provider_telemetry_events pte
          ${whereClause}
        `,
        baseParams,
      ),
      pool.query(
        `
          SELECT pte.service_name, COUNT(*) AS event_count, COUNT(DISTINCT pte.question_id) AS flow_count
          FROM provider_telemetry_events pte
          ${whereClause}
          GROUP BY pte.service_name
          ORDER BY event_count DESC
        `,
        baseParams,
      ),
      pool.query(
        `
          SELECT
            pte.id,
            pte.session_id,
            pte.question_id,
            pte.event_type,
            pte.service_name,
            pte.endpoint_url,
            pte.http_status,
            pte.latency_ms,
            pte.success,
            pte.error_message,
            pte.request_payload ->> 'use_case' AS request_type,
            pte.event_timestamp
          FROM provider_telemetry_events pte
          ${whereClause}
          ORDER BY pte.event_timestamp DESC
          LIMIT $${idx + 1} OFFSET $${idx + 2}
        `,
        listParams,
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM provider_telemetry_events pte ${whereClause}`,
        baseParams,
      ),
    ]);

    const summaryRow = summaryResult.rows[0];
    const totalCount = parseInt(countResult.rows[0].total) || 0;
    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalEvents: parseInt(summaryRow.total_events) || 0,
          totalFlows: parseInt(summaryRow.total_flows) || 0,
          uniqueSessions: parseInt(summaryRow.unique_sessions) || 0,
          successCount: parseInt(summaryRow.success_count) || 0,
          extApiCallCount: parseInt(summaryRow.ext_api_call_count) || 0,
          errorEventCount: parseInt(summaryRow.error_event_count) || 0,
          avgLatencyMs: summaryRow.avg_latency_ms !== null ? parseFloat(summaryRow.avg_latency_ms) : null,
          maxLatencyMs: summaryRow.max_latency_ms !== null ? parseInt(summaryRow.max_latency_ms) : null,
          byService: byServiceResult.rows.map((r) => ({
            serviceName: r.service_name,
            eventCount: parseInt(r.event_count) || 0,
            flowCount: parseInt(r.flow_count) || 0,
          })),
        },
        logs: listResult.rows.map((row) => ({
          id: row.id,
          sessionId: row.session_id,
          questionId: row.question_id,
          eventName: row.event_type,
          serviceName: row.service_name,
          requestType: row.request_type,
          endpointUrl: row.endpoint_url,
          httpStatus: row.http_status,
          latencyMs: row.latency_ms,
          success: row.success,
          errorMessage: row.error_message,
          eventTimestamp: row.event_timestamp,
        })),
      },
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
        nextPage: page < totalPages ? page + 1 : null,
        previousPage: page > 1 ? page - 1 : null,
      },
      filters,
    });
  } catch (error) {
    console.error("Error fetching provider telemetry data:", error);
    res.status(500).json({ success: false, error: "Error fetching provider telemetry data" });
  }
};

// GET /v1/provider-telemetry/flow/:questionId?state=...
// End-to-end view of a single flow: every provider_telemetry_events row that
// shares a question_id (the Beckn message_id), in step order, with full
// request/response payloads — powers the "click a row to see the whole
// query -> AI layer -> beckn network flow" detail page.
const getProviderTelemetryFlow = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
    const questionId = req.params.questionId ? String(req.params.questionId).trim() : null;

    if (!questionId) {
      return res.status(400).json({ success: false, error: "questionId is required" });
    }

    // Provider telemetry only exists for Bharat Vistaar today.
    if (telemetryState.id !== SUPPORTED_STATE_ID) {
      return res.status(200).json({
        success: true,
        data: { questionId, sessionId: null, summary: null, steps: [] },
      });
    }

    const result = await pool.query(
      `
        SELECT
          pte.id,
          pte.session_id,
          pte.question_id,
          pte.step_sequence,
          pte.event_type,
          pte.service_name,
          pte.beckn_transaction_id,
          pte.endpoint_url,
          pte.http_status,
          pte.latency_ms,
          pte.success,
          pte.error_message,
          pte.request_payload,
          pte.response_payload,
          pte.event_timestamp
        FROM provider_telemetry_events pte
        WHERE pte.question_id = $1
        ORDER BY pte.step_sequence ASC NULLS LAST, pte.event_timestamp ASC
      `,
      [questionId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "No telemetry flow found for this question" });
    }

    const steps = result.rows.map((row) => ({
      id: row.id,
      stepSequence: row.step_sequence,
      eventName: row.event_type,
      serviceName: row.service_name,
      becknTransactionId: row.beckn_transaction_id,
      endpointUrl: row.endpoint_url,
      httpStatus: row.http_status,
      latencyMs: row.latency_ms,
      success: row.success,
      errorMessage: row.error_message,
      requestPayload: row.request_payload,
      responsePayload: row.response_payload,
      eventTimestamp: row.event_timestamp,
    }));

    const flowEndStep = steps.find((s) => s.eventName === "flow_end");
    const hasErrorStep = steps.some((s) => s.eventName === "error" || s.success === false);
    const timestamps = steps.map((s) => new Date(s.eventTimestamp).getTime());
    const startedAt = steps[0].eventTimestamp;
    const completedAt = steps[steps.length - 1].eventTimestamp;
    const totalDurationMs = Math.max(...timestamps) - Math.min(...timestamps);
    const servicesInvolved = [...new Set(steps.map((s) => s.serviceName).filter(Boolean))];

    res.status(200).json({
      success: true,
      data: {
        questionId,
        sessionId: result.rows[0].session_id,
        summary: {
          totalSteps: steps.length,
          overallSuccess: flowEndStep ? flowEndStep.success : !hasErrorStep,
          hasError: hasErrorStep,
          startedAt,
          completedAt,
          totalDurationMs,
          servicesInvolved,
        },
        steps,
      },
    });
  } catch (error) {
    console.error("Error fetching provider telemetry flow:", error);
    res.status(500).json({ success: false, error: "Error fetching provider telemetry flow" });
  }
};

module.exports = {
  getProviderTelemetry,
  getProviderTelemetryFlow,
};
