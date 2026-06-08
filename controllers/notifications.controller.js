const pool = require("../services/db");
const { parseDateRange } = require("../utils/dateUtils");

const VALID_EVENT_GROUPS = new Set([
  "location",
  "notification_api",
  "notification_actions",
  "notification_feedback",
]);
const VALID_SORT_BY = new Set(["event_time", "status_code"]);
const VALID_SORT_ORDER = new Set(["asc", "desc"]);

function normalizeEventGroup(eventGroup) {
  return VALID_EVENT_GROUPS.has(eventGroup) ? eventGroup : "notification_api";
}

function normalizeSortBy(sortBy) {
  return VALID_SORT_BY.has(sortBy) ? sortBy : "event_time";
}

function normalizeSortOrder(sortOrder) {
  const normalized = String(sortOrder || "desc").toLowerCase();
  return VALID_SORT_ORDER.has(normalized) ? normalized : "desc";
}

function getStateChannelParams(telemetryState) {
  return {
    exactChannels: telemetryState?.exactChannels || [],
    prefixChannels: telemetryState?.prefixChannels || [],
  };
}

function getCommonParams(req) {
  const { startTimestamp, endTimestamp } = parseDateRange(req.query.startDate, req.query.endDate);
  const { exactChannels, prefixChannels } = getStateChannelParams(req.telemetryState);

  return {
    exactChannels,
    prefixChannels,
    startTimestamp,
    endTimestamp,
  };
}

async function getNotifications(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 100);
    const offset = (page - 1) * limit;
    const eventGroup = normalizeEventGroup(req.query.eventGroup || req.query.category);
    const sortBy = normalizeSortBy(req.query.sortBy);
    const sortOrder = normalizeSortOrder(req.query.sortOrder);
    const {
      exactChannels,
      prefixChannels,
      startTimestamp,
      endTimestamp,
    } = getCommonParams(req);

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
          response_count,
          created_at,
          COUNT(*) OVER () AS total_count
        FROM ui_interaction_events
        WHERE event_name IS NOT NULL
          AND (
            (
              COALESCE(array_length($1::text[], 1), 0) = 0
              AND COALESCE(array_length($2::text[], 1), 0) = 0
            )
            OR channel = ANY($1::text[])
            OR EXISTS (
              SELECT 1
              FROM unnest($2::text[]) AS prefixes(prefix)
              WHERE channel ILIKE prefixes.prefix || '%'
            )
          )
          AND (
            $3::double precision IS NULL
            OR COALESCE(event_time, to_timestamp(ets::double precision / 1000.0)) >= to_timestamp($3::double precision / 1000.0)
          )
          AND (
            $4::double precision IS NULL
            OR COALESCE(event_time, to_timestamp(ets::double precision / 1000.0)) <= to_timestamp($4::double precision / 1000.0)
          )
          AND (
            (
              $5::text = 'location'
              AND event_name IN (
                'location_browser_allow_this_time',
                'location_browser_allow_while_visiting_site',
                'location_browser_never_allow'
              )
            )
            OR ($5::text = 'notification_api' AND event_name = 'notification_api_response')
            OR ($5::text = 'notification_actions' AND category = 'notification' AND event_name <> 'notification_api_response')
            OR ($5::text = 'notification_feedback' AND category = 'notification_feedback')
          )
        ORDER BY
          CASE WHEN $6::text = 'event_time' AND $7::text = 'asc' THEN event_time END ASC NULLS LAST,
          CASE WHEN $6::text = 'event_time' AND $7::text = 'desc' THEN event_time END DESC NULLS LAST,
          CASE WHEN $6::text = 'status_code' AND $7::text = 'asc' THEN status_code END ASC NULLS LAST,
          CASE WHEN $6::text = 'status_code' AND $7::text = 'desc' THEN status_code END DESC NULLS LAST,
          CASE WHEN $6::text = 'status_code' THEN event_time END DESC NULLS LAST,
          CASE WHEN $6::text = 'event_time' AND $7::text = 'asc' THEN created_at END ASC NULLS LAST,
          CASE WHEN $6::text = 'event_time' AND $7::text = 'desc' THEN created_at END DESC NULLS LAST,
          created_at DESC
        LIMIT $8 OFFSET $9
      `,
      [
        exactChannels,
        prefixChannels,
        startTimestamp,
        endTimestamp,
        eventGroup,
        sortBy,
        sortOrder,
        limit,
        offset,
      ],
    );

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
    console.error("Error fetching notification telemetry:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification telemetry",
      error: error.message,
    });
  }
}

async function getNotificationSummary(req, res) {
  try {
    const {
      exactChannels,
      prefixChannels,
      startTimestamp,
      endTimestamp,
    } = getCommonParams(req);

    const result = await pool.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE event_name IN (
              'location_browser_allow_this_time',
              'location_browser_allow_while_visiting_site'
            )
          ) AS location_allowed,
          COUNT(*) FILTER (WHERE event_name = 'location_browser_never_allow') AS location_denied,
          COUNT(*) FILTER (
            WHERE event_name = 'notification_api_response'
              AND COALESCE(status_code, 0) = 200
          ) AS notification_api_success,
          COUNT(*) FILTER (WHERE event_name = 'notification_bell') AS notification_bell,
          COUNT(*) FILTER (WHERE event_name = 'notification_feedback_yes') AS feedback_yes,
          COUNT(*) FILTER (WHERE event_name = 'notification_feedback_no') AS feedback_no
        FROM ui_interaction_events
        WHERE event_name IS NOT NULL
          AND (
            (
              COALESCE(array_length($1::text[], 1), 0) = 0
              AND COALESCE(array_length($2::text[], 1), 0) = 0
            )
            OR channel = ANY($1::text[])
            OR EXISTS (
              SELECT 1
              FROM unnest($2::text[]) AS prefixes(prefix)
              WHERE channel ILIKE prefixes.prefix || '%'
            )
          )
          AND (
            $3::double precision IS NULL
            OR COALESCE(event_time, to_timestamp(ets::double precision / 1000.0)) >= to_timestamp($3::double precision / 1000.0)
          )
          AND (
            $4::double precision IS NULL
            OR COALESCE(event_time, to_timestamp(ets::double precision / 1000.0)) <= to_timestamp($4::double precision / 1000.0)
          )
      `,
      [exactChannels, prefixChannels, startTimestamp, endTimestamp],
    );

    res.json({
      success: true,
      data: result.rows[0] || {},
    });
  } catch (error) {
    console.error("Error fetching notification telemetry summary:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification telemetry summary",
      error: error.message,
    });
  }
}

async function getNotificationById(req, res) {
  try {
    const { exactChannels, prefixChannels } = getStateChannelParams(req.telemetryState);

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
          AND (
            (
              COALESCE(array_length($2::text[], 1), 0) = 0
              AND COALESCE(array_length($3::text[], 1), 0) = 0
            )
            OR channel = ANY($2::text[])
            OR EXISTS (
              SELECT 1
              FROM unnest($3::text[]) AS prefixes(prefix)
              WHERE channel ILIKE prefixes.prefix || '%'
            )
          )
        LIMIT 1
      `,
      [req.params.id, exactChannels, prefixChannels],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification telemetry event not found",
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching notification telemetry by ID:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification telemetry event",
      error: error.message,
    });
  }
}

module.exports = {
  getNotifications,
  getNotificationSummary,
  getNotificationById,
};
