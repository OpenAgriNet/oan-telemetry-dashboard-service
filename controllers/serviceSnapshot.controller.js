const pool = require("../services/db");
const { parseDateRange } = require("../utils/dateUtils");
const { buildServiceSnapshot } = require("../services/serviceSnapshot");

const categoryExpression = (tableAlias = "") => `
  COALESCE(
    ${tableAlias}request_payload #>> '{message,intent,category,descriptor,code}',
    ${tableAlias}request_payload #>> '{message,intent,category,descriptor,name}',
    ${tableAlias}request_payload #>> '{message,order,items,0,category_ids,0}',
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
          service AS source_service,
          ${categoryExpression()} AS service_category,
          COUNT(*) AS service_requests,
          COUNT(*) FILTER (WHERE outcome = 'success') AS successful_requests,
          COUNT(*) FILTER (WHERE outcome = 'failure') AS failed_requests,
          percentile_cont(0.90) WITHIN GROUP (ORDER BY duration_ms)
            FILTER (WHERE duration_ms IS NOT NULL) AS p90_latency_ms,
          MAX(duration_ms) AS max_latency_ms
        FROM external_api_events
        WHERE trace_scope = 'beckn_external_api'
          AND service = ANY($${dateFilter.values.length + 1})
          AND event_name = 'provider_request'
          ${dateFilter.sql}
        GROUP BY service, ${categoryExpression()}
      `,
      values: [...dateFilter.values, sourceServices],
    };

    const apiRequestsQuery = {
      text: `
        SELECT
          direct_event.service AS source_service,
          COALESCE(direct_event.method, 'POST') AS method,
          split_part(regexp_replace(COALESCE(direct_event.endpoint, ''), '^https?://[^/]+', ''), '?', 1) AS endpoint_path,
          CASE
            WHEN split_part(regexp_replace(COALESCE(direct_event.endpoint, ''), '^https?://[^/]+', ''), '?', 1)
              = '/webservices/fetch_nearest_five_common_data_by_location_and_category'
              THEN COALESCE(parent_request.service_category, '(unclassified)')
            ELSE '(endpoint-mapped)'
          END AS service_category,
          COUNT(*) AS api_requests,
          COUNT(*) FILTER (WHERE direct_event.outcome = 'success') AS successful_requests,
          COUNT(*) FILTER (WHERE direct_event.outcome = 'failure') AS failed_requests,
          percentile_cont(0.90) WITHIN GROUP (ORDER BY direct_event.duration_ms)
            FILTER (WHERE direct_event.duration_ms IS NOT NULL) AS p90_latency_ms,
          MAX(direct_event.duration_ms) AS max_latency_ms
        FROM external_api_events direct_event
        LEFT JOIN LATERAL (
          SELECT ${categoryExpression("parent_event.")} AS service_category
          FROM external_api_events parent_event
          WHERE parent_event.trace_scope = 'beckn_external_api'
            AND parent_event.service = direct_event.service
            AND parent_event.event_name = 'provider_request'
            AND (
              (direct_event.transaction_id IS NOT NULL AND parent_event.transaction_id = direct_event.transaction_id)
              OR (direct_event.transaction_id IS NULL AND parent_event.trace_id = direct_event.trace_id)
            )
          ORDER BY parent_event.event_time DESC
          LIMIT 1
        ) parent_request ON TRUE
        WHERE direct_event.trace_scope = 'beckn_external_api'
          AND direct_event.service = ANY($${dateFilter.values.length + 1})
          AND direct_event.event_name = 'provider_webservice_call'
          ${dateFilter.sql}
        GROUP BY
          direct_event.service,
          COALESCE(direct_event.method, 'POST'),
          split_part(regexp_replace(COALESCE(direct_event.endpoint, ''), '^https?://[^/]+', ''), '?', 1),
          CASE
            WHEN split_part(regexp_replace(COALESCE(direct_event.endpoint, ''), '^https?://[^/]+', ''), '?', 1)
              = '/webservices/fetch_nearest_five_common_data_by_location_and_category'
              THEN COALESCE(parent_request.service_category, '(unclassified)')
            ELSE '(endpoint-mapped)'
          END
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
