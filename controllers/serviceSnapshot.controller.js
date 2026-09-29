const pool = require("../services/db");
const { parseDateRange } = require("../utils/dateUtils");
const { buildServiceSnapshot } = require("../services/serviceSnapshot");

const categoryExpression = (tableAlias = "") => `
  COALESCE(
    ${tableAlias}request_payload #>> '{message,intent,category,descriptor,code}',
    ${tableAlias}request_payload #>> '{message,intent,category,descriptor,name}',
    ${tableAlias}request_payload #>> '{message,order,items,0,category_ids,0}',
    ${tableAlias}response_payload #>> '{message,intent,category,descriptor,code}',
    ${tableAlias}response_payload #>> '{message,intent,category,descriptor,name}',
    ${tableAlias}response_payload #>> '{message,order,items,0,category_ids,0}',
    '(unclassified)'
  )
`;

function buildDateFilter(startTimestamp, endTimestamp) {
  const values = [];
  const clauses = [];

  if (startTimestamp !== null) {
    values.push(new Date(startTimestamp));
    clauses.push(`event_time >= $${values.length}`);
  }
  if (endTimestamp !== null) {
    values.push(new Date(endTimestamp));
    clauses.push(`event_time <= $${values.length}`);
  }

  return { values, sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "" };
}

async function getServiceSnapshot(req, res) {
  const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
  const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
    return res.status(400).json({ success: false, error: "Invalid date format" });
  }

  if (startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp) {
    return res.status(400).json({ success: false, error: "Start date must be before end date" });
  }

  const dateFilter = buildDateFilter(startTimestamp, endTimestamp);
  const sourceServices = ["mh-provider-backend", "mh-pocradbt-provider-backend"];

  try {
    const serviceRequestsQuery = {
      text: `
        SELECT
          provider_event.service AS source_service,
          ${categoryExpression("provider_event.")} AS service_category,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(split_part(regexp_replace(COALESCE(provider_event.endpoint, ''), '^https?://[^/]+', ''), '?', 1), '')), NULL) AS provider_endpoints,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(provider_event.method, '')), NULL) AS provider_methods,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT linked_api.endpoint_path), NULL) AS linked_api_endpoints,
          COUNT(*) AS service_requests,
          COUNT(*) FILTER (WHERE provider_event.outcome = 'success') AS successful_requests,
          COUNT(*) FILTER (WHERE provider_event.outcome = 'failure') AS failed_requests,
          percentile_cont(0.90) WITHIN GROUP (ORDER BY provider_event.duration_ms)
            FILTER (WHERE provider_event.duration_ms IS NOT NULL) AS p90_latency_ms,
          MAX(provider_event.duration_ms) AS max_latency_ms
        FROM external_api_events provider_event
        LEFT JOIN LATERAL (
          SELECT split_part(regexp_replace(COALESCE(direct_event.endpoint, ''), '^https?://[^/]+', ''), '?', 1) AS endpoint_path
          FROM external_api_events direct_event
          WHERE direct_event.trace_scope = 'beckn_external_api'
            AND direct_event.service = provider_event.service
            AND direct_event.event_name = 'provider_webservice_call'
            AND NULLIF(TRIM(COALESCE(direct_event.endpoint, '')), '') IS NOT NULL
            AND (
              (provider_event.trace_id IS NOT NULL AND direct_event.trace_id = provider_event.trace_id)
              OR (
                provider_event.trace_id IS NULL
                AND provider_event.transaction_id IS NOT NULL
                AND direct_event.transaction_id = provider_event.transaction_id
              )
            )
          ORDER BY direct_event.event_time ASC NULLS LAST
          LIMIT 1
        ) linked_api ON TRUE
        WHERE provider_event.trace_scope = 'beckn_external_api'
          AND provider_event.service = ANY($${dateFilter.values.length + 1})
          AND provider_event.event_name = 'provider_request'
          ${dateFilter.sql}
        GROUP BY provider_event.service, ${categoryExpression("provider_event.")}
      `,
      values: [...dateFilter.values, sourceServices],
    };

    const apiRequestsQuery = {
      text: `
        SELECT
          direct_event.service AS source_service,
          NULLIF(TRIM(direct_event.method), '') AS method,
          split_part(regexp_replace(COALESCE(direct_event.endpoint, ''), '^https?://[^/]+', ''), '?', 1) AS endpoint_path,
          COALESCE(parent_request.service_category, '(unclassified)') AS parent_service_category,
          parent_request.provider_endpoint AS parent_provider_endpoint,
          COUNT(*) AS api_requests,
          COUNT(*) FILTER (WHERE direct_event.outcome = 'success') AS successful_requests,
          COUNT(*) FILTER (WHERE direct_event.outcome = 'failure') AS failed_requests,
          percentile_cont(0.90) WITHIN GROUP (ORDER BY direct_event.duration_ms)
            FILTER (WHERE direct_event.duration_ms IS NOT NULL) AS p90_latency_ms,
          MAX(direct_event.duration_ms) AS max_latency_ms
        FROM external_api_events direct_event
        LEFT JOIN LATERAL (
          SELECT
            ${categoryExpression("parent_event.")} AS service_category,
            split_part(regexp_replace(COALESCE(parent_event.endpoint, ''), '^https?://[^/]+', ''), '?', 1) AS provider_endpoint
          FROM external_api_events parent_event
          WHERE parent_event.trace_scope = 'beckn_external_api'
            AND parent_event.service = direct_event.service
            AND parent_event.event_name = 'provider_request'
            AND (
              (direct_event.trace_id IS NOT NULL AND parent_event.trace_id = direct_event.trace_id)
              OR (
                direct_event.trace_id IS NULL
                AND direct_event.transaction_id IS NOT NULL
                AND parent_event.transaction_id = direct_event.transaction_id
              )
            )
          ORDER BY parent_event.event_time DESC
          LIMIT 1
        ) parent_request ON TRUE
        WHERE direct_event.trace_scope = 'beckn_external_api'
          AND direct_event.service = ANY($${dateFilter.values.length + 1})
          AND direct_event.event_name = 'provider_webservice_call'
          AND NULLIF(TRIM(COALESCE(direct_event.endpoint, '')), '') IS NOT NULL
          ${dateFilter.sql}
        GROUP BY
          direct_event.service,
          NULLIF(TRIM(direct_event.method), ''),
          split_part(regexp_replace(COALESCE(direct_event.endpoint, ''), '^https?://[^/]+', ''), '?', 1),
          COALESCE(parent_request.service_category, '(unclassified)'),
          parent_request.provider_endpoint
      `,
      values: [...dateFilter.values, sourceServices],
    };

    const [serviceResult, apiResult] = await Promise.all([
      pool.query(serviceRequestsQuery),
      pool.query(apiRequestsQuery),
    ]);
    const providers = buildServiceSnapshot(serviceResult.rows, apiResult.rows);
    const services = providers.flatMap((provider) => provider.services);

    return res.status(200).json({
      success: true,
      data: {
        providers,
        summary: {
          providerCount: providers.length,
          serviceCount: services.length,
          serviceRequests: services.reduce((total, service) => total + service.metrics.requests, 0),
          apiRequests: services.reduce((total, service) => total + service.apiRequests, 0),
        },
      },
      filters: {
        startDate,
        endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    if (error.code === "42P01") {
      return res.status(200).json({
        success: true,
        data: { providers: [], summary: { providerCount: 0, serviceCount: 0, serviceRequests: 0, apiRequests: 0 } },
        filters: { startDate, endDate, appliedStartTimestamp: startTimestamp, appliedEndTimestamp: endTimestamp },
        warning: "External telemetry tables are not available yet.",
      });
    }

    console.error("Error fetching service snapshot:", error);
    return res.status(500).json({ success: false, error: "Error fetching service snapshot" });
  }
}

module.exports = { getServiceSnapshot };
