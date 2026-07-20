const pool = require("../services/db");
const { formatDateToIST, parseDateRange } = require("../utils/dateUtils");
const { buildChannelFilterClause } = require("../utils/stateAccess");

/**
 * Distinct external API identity: METHOD + URL path without query string.
 * e.g. many mandi calls with different lat/long/token count as 1 API.
 */
const EXT_API_ENDPOINT_SQL = `
  COALESCE(ext_api_method, '') || '|' ||
  CASE
    WHEN ext_api_url IS NOT NULL AND BTRIM(ext_api_url) <> ''
      THEN regexp_replace(ext_api_url, '\\?.*$', '')
    ELSE COALESCE(ext_api_service, '')
  END
`;

const TABLE_SORT_COLUMNS = {
  start_ets: "start_ets",
  end_ets: "end_ets",
  duration_ms: "duration_ms",
  service_name: "service_name",
  route_name: "route_name",
  ext_api_service: "ext_api_service",
  ext_api_latency_ms: "ext_api_latency_ms",
  ext_api_status_code: "ext_api_status_code",
  ext_api_success: "ext_api_success",
  beckn_latency_ms: "beckn_latency_ms",
  flow_status: "flow_status",
  created_at: "created_at",
};

/**
 * Build shared WHERE for beckn_ext_events using start_ets (uses idx_bee_start_ets / idx_bee_service).
 */
function buildBecknFilters({
  startDate,
  endDate,
  useCase,
  search,
  telemetryState,
  requireExtApi = false,
}) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
  const queryParams = [];
  let paramIndex = 0;
  let where = " WHERE 1=1 ";

  const {
    clause: channelClause,
    paramIndex: channelParamIndex,
  } = buildChannelFilterClause("channel", telemetryState, queryParams, paramIndex);
  paramIndex = channelParamIndex;
  where += ` AND ${channelClause}`;

  // Exclude Maharashtra advisory domain from external-API dashboards for now
  where += ` AND (beckn_domain IS NULL OR beckn_domain <> 'advisory:mh-vistaar')`;

  // Prefer start_ets for range (indexed). Fallback to created_at when start_ets is null.
  if (startTimestamp !== null) {
    paramIndex++;
    where += ` AND COALESCE(start_ets, created_at) >= to_timestamp($${paramIndex}::double precision / 1000.0)`;
    queryParams.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex++;
    where += ` AND COALESCE(start_ets, created_at) <= to_timestamp($${paramIndex}::double precision / 1000.0)`;
    queryParams.push(endTimestamp);
  }

  if (useCase && String(useCase).trim() !== "") {
    paramIndex++;
    where += ` AND service_name = $${paramIndex}`;
    queryParams.push(String(useCase).trim());
  }

  if (requireExtApi) {
    where += ` AND (ext_api_url IS NOT NULL OR ext_api_service IS NOT NULL)`;
  }

  if (search && String(search).trim() !== "") {
    paramIndex++;
    where += ` AND (
      service_name ILIKE $${paramIndex}
      OR route_name ILIKE $${paramIndex}
      OR ext_api_service ILIKE $${paramIndex}
      OR ext_api_url ILIKE $${paramIndex}
      OR beckn_action ILIKE $${paramIndex}
      OR request_path ILIKE $${paramIndex}
      OR CAST(session_id AS text) ILIKE $${paramIndex}
      OR CAST(question_id AS text) ILIKE $${paramIndex}
    )`;
    queryParams.push(`%${String(search).trim()}%`);
  }

  return { where, queryParams, paramIndex, startTimestamp, endTimestamp };
}

async function getBecknExtStats({
  startDate = null,
  endDate = null,
  useCase = null,
  telemetryState = null,
} = {}) {
  const { where, queryParams, startTimestamp, endTimestamp } = buildBecknFilters({
    startDate,
    endDate,
    useCase,
    telemetryState,
    requireExtApi: true,
  });

  // All four primary cards use the SAME grain: one row = one external API call
  // (lifecycle row with ext_api_*). So totalSuccess + totalErrors <= totalExternalApiCalls.
  // uniqueExternalApis is optional (distinct endpoints), not the main card value.
  const statsQuery = `
    SELECT
      COUNT(*)::int AS total_external_api_calls,
      COUNT(*) FILTER (WHERE ext_api_success IS TRUE)::int AS total_success,
      COUNT(*) FILTER (WHERE ext_api_success IS FALSE)::int AS total_errors,
      COUNT(*) FILTER (WHERE ext_api_success IS NULL)::int AS total_unknown,
      COALESCE(MAX(ext_api_latency_ms), 0)::int AS max_latency_ms,
      COUNT(DISTINCT ${EXT_API_ENDPOINT_SQL})::int AS unique_external_apis
    FROM beckn_ext_events
    ${where}
  `;

  const useCasesQuery = `
    SELECT service_name AS use_case, COUNT(*)::int AS count
    FROM beckn_ext_events
    ${where}
      AND service_name IS NOT NULL
      AND BTRIM(service_name) <> ''
    GROUP BY service_name
    ORDER BY count DESC, service_name ASC
  `;

  const [statsRes, useCasesRes] = await Promise.all([
    pool.query(statsQuery, queryParams),
    pool.query(useCasesQuery, queryParams),
  ]);

  const row = statsRes.rows[0] || {};
  const totalExternalApiCalls = parseInt(row.total_external_api_calls, 10) || 0;
  const totalSuccess = parseInt(row.total_success, 10) || 0;
  const totalErrors = parseInt(row.total_errors, 10) || 0;
  const totalUnknown = parseInt(row.total_unknown, 10) || 0;
  const maxLatencyMs = parseInt(row.max_latency_ms, 10) || 0;
  const uniqueExternalApis = parseInt(row.unique_external_apis, 10) || 0;

  return {
    // Primary cards (consistent: all are invocation / row counts)
    totalExternalApiCalls,
    totalSuccess,
    totalErrors,
    maxLatencyMs,
    // Supporting
    totalUnknown,
    uniqueExternalApis,
    totalInvocations: totalExternalApiCalls,
    successRate:
      totalExternalApiCalls > 0
        ? Math.round((totalSuccess / totalExternalApiCalls) * 100)
        : 0,
    useCases: useCasesRes.rows.map((r) => ({
      useCase: r.use_case,
      count: parseInt(r.count, 10) || 0,
    })),
    filters: {
      startDate,
      endDate,
      useCase: useCase || null,
      appliedStartTimestamp: startTimestamp,
      appliedEndTimestamp: endTimestamp,
    },
  };
}

async function fetchBecknExtRows({
  page = 1,
  limit = 10,
  startDate = null,
  endDate = null,
  useCase = null,
  search = "",
  sortBy = "start_ets",
  sortOrder = "DESC",
  includePayloads = false,
  telemetryState = null,
} = {}) {
  const offset = (page - 1) * limit;
  const { where, queryParams, paramIndex: baseParamIndex, startTimestamp, endTimestamp } =
    buildBecknFilters({
      startDate,
      endDate,
      useCase,
      search,
      telemetryState,
      requireExtApi: false,
    });

  let paramIndex = baseParamIndex;
  const sortColumn = TABLE_SORT_COLUMNS[sortBy] || "start_ets";
  const order = String(sortOrder || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";

  // Date columns: use COALESCE so rows with only created_at still sort correctly;
  // default DESC → latest activity at the top.
  const orderByClause =
    sortColumn === "start_ets" || sortColumn === "end_ets" || sortColumn === "created_at"
      ? `COALESCE(start_ets, created_at) ${order} NULLS LAST, id DESC`
      : `${sortColumn} ${order} NULLS LAST, COALESCE(start_ets, created_at) DESC NULLS LAST, id DESC`;

  const payloadSelect = includePayloads
    ? `
      ext_api_request,
      ext_api_response,
      ext_api_error,
      beckn_request,
      beckn_response,
      beckn_error,
      flow_error,
    `
    : "";

  let dataQuery = `
    SELECT
      id,
      session_id,
      question_id,
      service_name,
      route_name,
      channel,
      beckn_action,
      beckn_domain,
      beckn_transaction_id,
      beckn_message_id,
      request_path,
      start_ets,
      end_ets,
      duration_ms,
      flow_status,
      flow_success,
      ext_api_service,
      ext_api_method,
      ext_api_url,
      ext_api_status_code,
      ext_api_latency_ms,
      ext_api_success,
      beckn_api_service,
      beckn_method,
      beckn_url,
      beckn_status_code,
      beckn_latency_ms,
      beckn_success,
      created_at
      ${includePayloads ? `, ${payloadSelect.replace(/,\s*$/, "")}` : ""}
    FROM beckn_ext_events
    ${where}
    ORDER BY ${orderByClause}
  `;

  paramIndex++;
  dataQuery += ` LIMIT $${paramIndex}`;
  queryParams.push(limit);

  paramIndex++;
  dataQuery += ` OFFSET $${paramIndex}`;
  queryParams.push(offset);

  // Count uses same filters without limit — reuse params without limit/offset
  const countParams = queryParams.slice(0, -2);
  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM beckn_ext_events
    ${where}
  `;

  const [dataRes, countRes] = await Promise.all([
    pool.query(dataQuery, queryParams),
    pool.query(countQuery, countParams),
  ]);

  return {
    rows: dataRes.rows,
    totalCount: parseInt(countRes.rows[0]?.total, 10) || 0,
    startTimestamp,
    endTimestamp,
  };
}

function formatBecknExtRow(row, includePayloads = false) {
  const startEts = row.start_ets ? new Date(row.start_ets) : null;
  const endEts = row.end_ets ? new Date(row.end_ets) : null;
  const createdAt = row.created_at ? new Date(row.created_at) : null;

  const base = {
    id: row.id != null ? String(row.id) : null,
    sessionId: row.session_id,
    questionId: row.question_id,
    useCase: row.service_name,
    serviceName: row.service_name,
    routeName: row.route_name,
    channel: row.channel,
    becknAction: row.beckn_action,
    becknDomain: row.beckn_domain,
    becknTransactionId: row.beckn_transaction_id,
    becknMessageId: row.beckn_message_id,
    requestPath: row.request_path,
    startEts: startEts ? startEts.toISOString() : null,
    endEts: endEts ? endEts.toISOString() : null,
    startEtsIst: startEts ? formatDateToIST(startEts.getTime()) : null,
    endEtsIst: endEts ? formatDateToIST(endEts.getTime()) : null,
    durationMs: row.duration_ms,
    flowStatus: row.flow_status,
    flowSuccess: row.flow_success,
    extApiService: row.ext_api_service,
    extApiMethod: row.ext_api_method,
    extApiUrl: row.ext_api_url,
    extApiStatusCode: row.ext_api_status_code,
    extApiLatencyMs: row.ext_api_latency_ms,
    extApiSuccess: row.ext_api_success,
    becknApiService: row.beckn_api_service,
    becknMethod: row.beckn_method,
    becknUrl: row.beckn_url,
    becknStatusCode: row.beckn_status_code,
    becknLatencyMs: row.beckn_latency_ms,
    becknSuccess: row.beckn_success,
    createdAt: createdAt ? createdAt.toISOString() : null,
    createdAtIst: createdAt ? formatDateToIST(createdAt.getTime()) : null,
  };

  if (includePayloads) {
    base.extApiRequest = row.ext_api_request ?? null;
    base.extApiResponse = row.ext_api_response ?? null;
    base.extApiError = row.ext_api_error ?? null;
    base.becknRequest = row.beckn_request ?? null;
    base.becknResponse = row.beckn_response ?? null;
    base.becknError = row.beckn_error ?? null;
    base.flowError = row.flow_error ?? null;
  }

  return base;
}

/**
 * Load one lifecycle row by session_id + question_id (unique key),
 * or by question_id alone (latest row).
 * Includes full request/response payloads.
 */
async function fetchBecknExtLifecycle({
  sessionId = null,
  questionId = null,
  id = null,
  telemetryState = null,
} = {}) {
  const queryParams = [];
  let paramIndex = 0;
  let where = " WHERE 1=1 ";

  const {
    clause: channelClause,
    paramIndex: channelParamIndex,
  } = buildChannelFilterClause("channel", telemetryState, queryParams, paramIndex);
  paramIndex = channelParamIndex;
  where += ` AND ${channelClause}`;
  where += ` AND (beckn_domain IS NULL OR beckn_domain <> 'advisory:mh-vistaar')`;

  if (id != null && String(id).trim() !== "") {
    paramIndex++;
    where += ` AND id = $${paramIndex}`;
    queryParams.push(String(id).trim());
  } else if (sessionId && questionId) {
    paramIndex++;
    where += ` AND session_id = $${paramIndex}`;
    queryParams.push(String(sessionId).trim());
    paramIndex++;
    where += ` AND question_id = $${paramIndex}`;
    queryParams.push(String(questionId).trim());
  } else if (questionId) {
    paramIndex++;
    where += ` AND question_id = $${paramIndex}`;
    queryParams.push(String(questionId).trim());
  } else {
    return null;
  }

  const result = await pool.query(
    `
    SELECT *
    FROM beckn_ext_events
    ${where}
    ORDER BY COALESCE(start_ets, created_at) DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    queryParams,
  );

  if (!result.rows.length) return null;
  return result.rows[0];
}

/**
 * Shape a full lifecycle for the flow UI: FLOW_START → BECKN → EXT_API → FLOW_END
 */
function formatBecknExtLifecycle(row) {
  const detail = formatBecknExtRow(row, true);

  const steps = [];

  steps.push({
    step: 1,
    type: "flow_start",
    label: "Flow Start",
    description: "Beckn flow context and identifiers",
    success: null,
    timestamp: detail.startEts,
    meta: {
      serviceName: detail.serviceName,
      routeName: detail.routeName,
      channel: detail.channel,
      becknAction: detail.becknAction,
      becknDomain: detail.becknDomain,
      becknTransactionId: detail.becknTransactionId,
      becknMessageId: detail.becknMessageId,
      requestPath: detail.requestPath,
      sessionId: detail.sessionId,
      questionId: detail.questionId,
    },
    requestPayload: null,
    responsePayload: null,
    errorMessage: null,
    httpStatus: null,
    latencyMs: null,
    method: null,
    endpointUrl: null,
  });

  const hasBeckn =
    detail.becknUrl ||
    detail.becknApiService ||
    detail.becknRequest != null ||
    detail.becknResponse != null;
  if (hasBeckn) {
    steps.push({
      step: steps.length + 1,
      type: "beckn_network",
      label: "Beckn Network Call",
      description: "BAP / network API (e.g. /search)",
      success: detail.becknSuccess,
      timestamp: detail.endEts || detail.startEts,
      meta: {
        service: detail.becknApiService,
        method: detail.becknMethod,
        url: detail.becknUrl,
        statusCode: detail.becknStatusCode,
        latencyMs: detail.becknLatencyMs,
      },
      requestPayload: detail.becknRequest,
      responsePayload: detail.becknResponse,
      errorMessage: detail.becknError,
      httpStatus: detail.becknStatusCode,
      latencyMs: detail.becknLatencyMs,
      method: detail.becknMethod,
      endpointUrl: detail.becknUrl,
    });
  }

  const hasExt =
    detail.extApiUrl ||
    detail.extApiService ||
    detail.extApiRequest != null ||
    detail.extApiResponse != null;
  if (hasExt) {
    steps.push({
      step: steps.length + 1,
      type: "ext_api",
      label: "External API Call",
      description: "Downstream HTTP call to external service",
      success: detail.extApiSuccess,
      timestamp: detail.startEts,
      meta: {
        service: detail.extApiService,
        method: detail.extApiMethod,
        url: detail.extApiUrl,
        statusCode: detail.extApiStatusCode,
        latencyMs: detail.extApiLatencyMs,
      },
      requestPayload: detail.extApiRequest,
      responsePayload: detail.extApiResponse,
      errorMessage: detail.extApiError,
      httpStatus: detail.extApiStatusCode,
      latencyMs: detail.extApiLatencyMs,
      method: detail.extApiMethod,
      endpointUrl: detail.extApiUrl,
    });
  }

  steps.push({
    step: steps.length + 1,
    type: "flow_end",
    label: "Flow End",
    description: "Lifecycle completion status",
    success: detail.flowSuccess,
    timestamp: detail.endEts,
    meta: {
      flowStatus: detail.flowStatus,
      flowSuccess: detail.flowSuccess,
      durationMs: detail.durationMs,
      endEts: detail.endEts,
    },
    requestPayload: null,
    responsePayload: null,
    errorMessage: detail.flowError,
    httpStatus: null,
    latencyMs: detail.durationMs,
    method: null,
    endpointUrl: null,
  });

  const overallSuccess =
    detail.flowSuccess === true ||
    (detail.flowSuccess == null &&
      detail.extApiSuccess !== false &&
      detail.becknSuccess !== false);

  return {
    id: detail.id,
    sessionId: detail.sessionId,
    questionId: detail.questionId,
    serviceName: detail.serviceName,
    routeName: detail.routeName,
    channel: detail.channel,
    becknAction: detail.becknAction,
    becknDomain: detail.becknDomain,
    becknTransactionId: detail.becknTransactionId,
    becknMessageId: detail.becknMessageId,
    requestPath: detail.requestPath,
    summary: {
      overallSuccess,
      flowStatus: detail.flowStatus,
      flowSuccess: detail.flowSuccess,
      durationMs: detail.durationMs,
      startEts: detail.startEts,
      endEts: detail.endEts,
      startEtsIst: detail.startEtsIst,
      endEtsIst: detail.endEtsIst,
      totalSteps: steps.length,
      extApiSuccess: detail.extApiSuccess,
      becknSuccess: detail.becknSuccess,
    },
    // Full flat record (payloads included) for advanced consumers
    detail,
    steps,
  };
}

/**
 * GET /v1/beckn-ext/lifecycle/:questionId?sessionId=
 * Full API lifecycle (flow start → beckn → ext API → flow end) with payloads
 */
const getBecknExtLifecycleHandler = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
    const questionId = req.params.questionId
      ? String(req.params.questionId).trim()
      : req.query.questionId
        ? String(req.query.questionId).trim()
        : null;
    const sessionId = req.query.sessionId
      ? String(req.query.sessionId).trim()
      : null;
    const id = req.query.id ? String(req.query.id).trim() : null;

    if (!id && !questionId) {
      return res.status(400).json({
        message: "questionId path/query param (or id) is required",
      });
    }

    const row = await fetchBecknExtLifecycle({
      sessionId,
      questionId,
      id,
      telemetryState,
    });

    if (!row) {
      return res.status(404).json({
        message: "Lifecycle not found for the given identifiers",
      });
    }

    const lifecycle = formatBecknExtLifecycle(row);
    return res.status(200).json({ data: lifecycle });
  } catch (error) {
    console.error("Error fetching beckn_ext lifecycle:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

/**
 * GET /v1/beckn-ext/stats
 * Cards: Total External API Calls (unique endpoints), Total Success, Total Errors, Max Latency
 * Filters: startDate, endDate, useCase (service_name)
 */
const getBecknExtStatsHandler = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const useCase = req.query.useCase
      ? String(req.query.useCase).trim()
      : req.query.serviceName
        ? String(req.query.serviceName).trim()
        : null;

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res.status(400).json({
        message:
          "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }
    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res
        .status(400)
        .json({ message: "Start date cannot be after end date" });
    }

    const stats = await getBecknExtStats({
      startDate,
      endDate,
      useCase,
      telemetryState,
    });

    return res.status(200).json({
      // Primary cards — all same grain (1 row = 1 external API call)
      totalExternalApiCalls: stats.totalExternalApiCalls,
      totalSuccess: stats.totalSuccess,
      totalErrors: stats.totalErrors,
      maxLatencyMs: stats.maxLatencyMs,
      // Supporting fields
      totalInvocations: stats.totalInvocations,
      totalUnknown: stats.totalUnknown,
      uniqueExternalApis: stats.uniqueExternalApis,
      successRate: stats.successRate,
      useCases: stats.useCases,
      filters: stats.filters,
      meta: {
        totalExternalApiCallsDefinition:
          "COUNT(*) of beckn_ext_events rows with external API data (one lifecycle / call per row). success + errors (+ unknown) = total.",
        totalSuccessDefinition:
          "COUNT where ext_api_success = true (same grain as total)",
        totalErrorsDefinition:
          "COUNT where ext_api_success = false (same grain as total)",
        maxLatencyDefinition: "MAX(ext_api_latency_ms) over matching rows",
        uniqueExternalApisDefinition:
          "Optional: COUNT(DISTINCT method + URL path without query params)",
      },
    });
  } catch (error) {
    console.error("Error fetching beckn_ext stats:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

/**
 * GET /v1/beckn-ext
 * Paginated table for beckn_ext_events
 * Filters: startDate, endDate, useCase, search, page, limit, sortBy, sortOrder, includePayloads
 */
const getBecknExtListHandler = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const useCase = req.query.useCase
      ? String(req.query.useCase).trim()
      : req.query.serviceName
        ? String(req.query.serviceName).trim()
        : null;
    const sortBy = req.query.sortBy
      ? String(req.query.sortBy).trim()
      : "start_ets";
    const sortOrder = req.query.sortOrder === "asc" ? "ASC" : "DESC";
    const includePayloads =
      String(req.query.includePayloads || "").toLowerCase() === "true";

    if (search.length > 1000) {
      return res.status(400).json({ message: "Search term too long" });
    }

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res.status(400).json({
        message:
          "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }
    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res
        .status(400)
        .json({ message: "Start date cannot be after end date" });
    }

    const { rows, totalCount } = await fetchBecknExtRows({
      page,
      limit,
      startDate,
      endDate,
      useCase,
      search,
      sortBy,
      sortOrder,
      includePayloads,
      telemetryState,
    });

    const totalPages = Math.max(1, Math.ceil(totalCount / limit) || 1);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return res.status(200).json({
      data: rows.map((row) => formatBecknExtRow(row, includePayloads)),
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage,
        hasPreviousPage,
        nextPage: hasNextPage ? page + 1 : null,
        previousPage: hasPreviousPage ? page - 1 : null,
      },
      filters: {
        search,
        startDate,
        endDate,
        useCase: useCase || null,
        sortBy: TABLE_SORT_COLUMNS[sortBy] ? sortBy : "start_ets",
        sortOrder: sortOrder.toLowerCase(),
        includePayloads,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching beckn_ext list:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

module.exports = {
  getBecknExtStatsHandler,
  getBecknExtListHandler,
  getBecknExtLifecycleHandler,
  // exported for tests / reuse
  getBecknExtStats,
  fetchBecknExtRows,
  fetchBecknExtLifecycle,
  formatBecknExtLifecycle,
};
