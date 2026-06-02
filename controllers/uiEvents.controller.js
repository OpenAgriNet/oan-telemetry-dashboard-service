const pool = require("../services/db");
const { parseDateRange } = require("../utils/dateUtils");
const { buildChannelFilterClause } = require("../utils/stateAccess");

const VALID_CATEGORIES = new Set(["location", "notification", "notification_feedback"]);
const VALID_SORT_BY = new Set(["event_time", "status_code"]);
const VALID_SORT_ORDER = new Set(["asc", "desc"]);

function normalizeCategory(category) {
  if (!category || category === "all") return null;
  return VALID_CATEGORIES.has(category) ? category : null;
}

function normalizeSortBy(sortBy) {
  return VALID_SORT_BY.has(sortBy) ? sortBy : "event_time";
}

function normalizeSortOrder(sortOrder) {
  const normalized = String(sortOrder || "desc").toLowerCase();
  return VALID_SORT_ORDER.has(normalized) ? normalized : "desc";
}

function buildBaseFilters({
  query,
  telemetryState,
}) {
  const params = [];
  let idx = 0;
  const conditions = ["event_name IS NOT NULL"];

  const {
    clause: stateChannelClause,
    paramIndex: stateChannelParamIndex,
  } = buildChannelFilterClause("channel", telemetryState, params, idx);
  idx = stateChannelParamIndex;
  conditions.push(stateChannelClause);

  const { startTimestamp, endTimestamp } = parseDateRange(query.startDate, query.endDate);

  if (startTimestamp !== null) {
    idx += 1;
    conditions.push(`COALESCE(event_time, to_timestamp(ets::double precision / 1000.0)) >= to_timestamp($${idx}::double precision / 1000.0)`);
    params.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    idx += 1;
    conditions.push(`COALESCE(event_time, to_timestamp(ets::double precision / 1000.0)) <= to_timestamp($${idx}::double precision / 1000.0)`);
    params.push(endTimestamp);
  }

  const category = normalizeCategory(query.category);
  if (category) {
    idx += 1;
    conditions.push(`category = $${idx}`);
    params.push(category);
  }

  return {
    where: `WHERE ${conditions.join(" AND ")}`,
    params,
    paramIndex: idx,
  };
}

async function getUiEvents(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 100);
    const offset = (page - 1) * limit;
    const sortBy = normalizeSortBy(req.query.sortBy);
    const sortOrder = normalizeSortOrder(req.query.sortOrder);

    const { where, params, paramIndex } = buildBaseFilters({
      query: req.query,
      telemetryState: req.telemetryState,
    });

    let idx = paramIndex;
    idx += 1;
    const limitParam = idx;
    params.push(limit);
    idx += 1;
    const offsetParam = idx;
    params.push(offset);

    const orderBy =
      sortBy === "status_code"
        ? `ORDER BY status_code ${sortOrder}, event_time DESC NULLS LAST, created_at DESC`
        : `ORDER BY event_time ${sortOrder} NULLS LAST, created_at ${sortOrder}`;

    const sql = `
      SELECT
        id,
        source_log_id,
        source_event_index,
        eid,
        uid,
        fingerprint_id,
        sid,
        channel,
        ets,
        event_name,
        category,
        event_time,
        metadata,
        notification_id,
        action,
        reason,
        feedback,
        status_code,
        success,
        response_count,
        created_at,
        COUNT(*) OVER () AS total_count
      FROM ui_interaction_events
      ${where}
      ${orderBy}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await pool.query(sql, params);
    const total = result.rows.length ? parseInt(result.rows[0].total_count, 10) : 0;

    const data = result.rows.map(({ total_count, ...row }) => row);

    res.json({
      success: true,
      data,
      pagination: {
        total,
        currentPage: page,
        itemsPerPage: limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching UI events:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch UI events",
      error: error.message,
    });
  }
}

async function getUiEventById(req, res) {
  try {
    const params = [req.params.id];
    let idx = 1;

    const {
      clause: stateChannelClause,
      paramIndex,
    } = buildChannelFilterClause("channel", req.telemetryState, params, idx);
    idx = paramIndex;

    const result = await pool.query(
      `
        SELECT
          id,
          source_log_id,
          source_event_index,
          eid,
          uid,
          fingerprint_id,
          sid,
          channel,
          ets,
          event_name,
          category,
          event_time,
          metadata,
          notification_id,
          action,
          reason,
          feedback,
          status_code,
          success,
          response,
          response_count,
          created_at
        FROM ui_interaction_events
        WHERE id = $1
          AND ${stateChannelClause}
        LIMIT 1
      `,
      params,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "UI event not found",
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching UI event by ID:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch UI event",
      error: error.message,
    });
  }
}

module.exports = {
  getUiEvents,
  getUiEventById,
};
