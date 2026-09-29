const pool = require("../services/db");
const { parseDateRange } = require("../utils/dateUtils");

const PAGE_SIZE = 10;
const SOURCE_SERVICES = new Set([
  "mh-provider-backend",
  "mh-pocradbt-provider-backend",
]);

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

function parsePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function parseCategories(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return null;
    const categories = [...new Set(parsed
      .filter((category) => typeof category === "string")
      .map((category) => category.trim())
      .filter(Boolean))];
    return categories.length <= 30 && categories.every((category) => category.length <= 200)
      ? categories
      : null;
  } catch {
    return null;
  }
}

function normalisedEndpointExpression(tableAlias = "") {
  return `split_part(regexp_replace(COALESCE(${tableAlias}endpoint, ''), '^https?://[^/]+', ''), '?', 1)`;
}

function buildScope(req) {
  const sourceService = String(req.query.sourceService || "").trim();
  const endpoint = String(req.query.endpoint || "").trim();
  const method = req.query.method ? String(req.query.method).trim() : null;
  const kind = String(req.query.kind || "direct").trim();
  const categories = parseCategories(req.query.categories);

  if (!SOURCE_SERVICES.has(sourceService)) return { error: "Invalid source service" };
  if (!endpoint || endpoint.length > 2000 || !endpoint.startsWith("/")) return { error: "Invalid API endpoint" };
  if (method && method.length > 20) return { error: "Invalid HTTP method" };
  if (kind !== "direct" && kind !== "fallback") return { error: "Invalid API type" };
  if (categories === null) return { error: "Invalid API categories" };

  return { sourceService, endpoint, method: method || null, kind, categories };
}

function buildDateRange(req) {
  const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
  const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
    return { error: "Invalid date format" };
  }
  if (startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp) {
    return { error: "Start date must be before end date" };
  }
  return { startDate, endDate, startTimestamp, endTimestamp };
}

function scopedQueryParts({ scope, range, outcome }) {
  const values = [scope.sourceService, scope.kind === "fallback" ? "provider_request" : "provider_webservice_call", scope.endpoint, scope.method];
  const where = [
    "direct_event.trace_scope = 'beckn_external_api'",
    "direct_event.service = $1",
    "direct_event.event_name = $2",
    `${normalisedEndpointExpression("direct_event.")} = $3`,
    "NULLIF(TRIM(direct_event.method), '') IS NOT DISTINCT FROM $4",
  ];
  let from = "external_api_events direct_event";

  if (scope.categories.length) {
    if (scope.kind === "fallback") {
      values.push(scope.categories);
      where.push(`${categoryExpression("direct_event.")} = ANY($${values.length}::text[])`);
    } else {
      from += `
        LEFT JOIN LATERAL (
          SELECT ${categoryExpression("parent_event.")} AS service_category
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
        ) parent_request ON TRUE`;
      values.push(scope.categories);
      where.push(`COALESCE(parent_request.service_category, '(unclassified)') = ANY($${values.length}::text[])`);
    }
  }

  if (range.startTimestamp !== null) {
    values.push(new Date(range.startTimestamp));
    where.push(`direct_event.event_time >= $${values.length}`);
  }
  if (range.endTimestamp !== null) {
    values.push(new Date(range.endTimestamp));
    where.push(`direct_event.event_time <= $${values.length}`);
  }
  if (outcome === "success" || outcome === "failure") {
    values.push(outcome);
    where.push(`direct_event.outcome = $${values.length}`);
  }

  return { from, where: where.join(" AND "), values };
}

async function getServiceApiCalls(req, res) {
  const scope = buildScope(req);
  if (scope.error) return res.status(400).json({ success: false, error: scope.error });

  const range = buildDateRange(req);
  if (range.error) return res.status(400).json({ success: false, error: range.error });

  const outcome = String(req.query.outcome || "").trim().toLowerCase();
  const page = parsePage(req.query.page);
  const queryParts = scopedQueryParts({ scope, range, outcome });

  try {
    const countQuery = {
      text: `
        SELECT
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE direct_event.outcome = 'success')::integer AS successful,
          COUNT(*) FILTER (WHERE direct_event.outcome = 'failure')::integer AS failed
        FROM ${queryParts.from}
        WHERE ${queryParts.where}
      `,
      values: queryParts.values,
    };
    const callsQuery = {
      text: `
        SELECT
          direct_event.id, direct_event.event_mid, direct_event.trace_id, direct_event.event_name,
          direct_event.layer, direct_event.service, direct_event.dependency, direct_event.method,
          direct_event.endpoint, direct_event.outcome, direct_event.http_status,
          direct_event.response_status, direct_event.error_payload, direct_event.event_time,
          direct_event.duration_ms, direct_event.request_payload IS NOT NULL AS has_request_payload,
          direct_event.response_payload IS NOT NULL AS has_response_payload,
          direct_event.error_payload IS NOT NULL AS has_error_payload
        FROM ${queryParts.from}
        WHERE ${queryParts.where}
        ORDER BY direct_event.event_time DESC NULLS LAST, direct_event.id DESC
        LIMIT $${queryParts.values.length + 1} OFFSET $${queryParts.values.length + 2}
      `,
      values: [...queryParts.values, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    };

    const [countResult, callsResult] = await Promise.all([pool.query(countQuery), pool.query(callsQuery)]);
    const summary = countResult.rows[0];
    const total = summary.total || 0;

    return res.status(200).json({
      success: true,
      data: {
        calls: callsResult.rows,
        summary: { total, successful: summary.successful || 0, failed: summary.failed || 0 },
      },
      pagination: { page, limit: PAGE_SIZE, total, totalPages: total ? Math.ceil(total / PAGE_SIZE) : 0 },
      filters: { startDate: range.startDate, endDate: range.endDate, outcome: outcome || null },
    });
  } catch (error) {
    if (error.code === "42P01") {
      return res.status(200).json({
        success: true,
        data: { calls: [], summary: { total: 0, successful: 0, failed: 0 } },
        pagination: { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 },
        filters: { startDate: range.startDate, endDate: range.endDate, outcome: outcome || null },
        warning: "External telemetry tables are not available yet.",
      });
    }
    console.error("Error fetching service API calls:", error);
    return res.status(500).json({ success: false, error: "Error fetching service API calls" });
  }
}

module.exports = { buildScope, scopedQueryParts, getServiceApiCalls, PAGE_SIZE };
