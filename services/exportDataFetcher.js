const pool = require("./db");
const fs = require("fs");
const { parseDateRange } = require("../utils/dateUtils");
const { buildChannelFilterClause } = require("../utils/stateAccess");
const { STATE_CONFIG } = require("../utils/stateAccess");
const { utcTimestampToIstTimestamp } = require("../utils/istSql");
const {
  fetchQuestionsFromDB,
  formatQuestionData,
} = require("../controllers/questions.controller");
const {
  fetchAllFeedbackFromDB,
  formatFeedbackData,
} = require("../controllers/feedback.controller");

const EXPORT_PAGE_SIZE = parseInt(process.env.EXPORT_PAGE_SIZE || "5000", 10);
const MAX_EXPORT_ROWS = parseInt(process.env.EXPORT_MAX_ROWS || "1000000", 10);

function normalizeExportDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function getParsedFilters(exportRecord) {
  const { filters } = exportRecord;
  if (!filters) {
    return {};
  }

  return typeof filters === "string" ? JSON.parse(filters) : filters;
}

function getExportContext(exportRecord) {
  return {
    moduleName: exportRecord.module_name,
    startDate: normalizeExportDate(exportRecord.from_date),
    endDate: normalizeExportDate(exportRecord.to_date),
    telemetryStateId: exportRecord.telemetry_state,
    filters: getParsedFilters(exportRecord),
  };
}

const STATE_COLUMN = { key: "telemetryState", header: "State" };
const EXPORTED_BY_COLUMN = { key: "exportedBy", header: "Exported By" };

function getStateLabel(stateId) {
  if (!stateId) {
    return "All";
  }
  return STATE_CONFIG[stateId]?.label || stateId;
}

function attachStateToRows(rows, telemetryStateId) {
  const label = getStateLabel(telemetryStateId);
  return rows.map((row) => ({ ...row, telemetryState: label }));
}

function resolveFingerprint(row) {
  return (
    row.fingerprint ??
    row.fingerprint_id ??
    row.user_id ??
    row.user ??
    row.userId ??
    ""
  );
}

function enrichExportRows(rows, exportRecord) {
  const exportedBy = exportRecord.username || exportRecord.user_id || "N/A";

  return rows.map((row) => ({
    ...row,
    telemetryState: getStateLabel(exportRecord.telemetry_state),
    exportedBy,
    fingerprint: resolveFingerprint(row),
  }));
}

function getExportColumns(exportRecord, filters) {
  let columns;
  if (exportRecord.module_name === "notifications" && filters.eventGroup === "sessions") {
    columns = MODULE_COLUMNS["notifications-sessions"];
  } else {
    columns = MODULE_COLUMNS[exportRecord.module_name];
  }

  return [STATE_COLUMN, EXPORTED_BY_COLUMN, ...columns];
}

async function fetchAllPages(fetchPage) {
  const allRows = [];
  let page = 1;

  while (true) {
    const rows = await fetchPage(page, EXPORT_PAGE_SIZE);
    if (!rows.length) {
      break;
    }

    allRows.push(...rows);
    if (rows.length < EXPORT_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return allRows;
}

function getTelemetryState(stateId) {
  return stateId ? STATE_CONFIG[stateId] || null : null;
}

async function fetchQuestionsExportData({ startDate, endDate, filters, telemetryStateId }) {
  const telemetryState = getTelemetryState(telemetryStateId);
  const search = filters.search || "";
  const sortBy = filters.sortBy || null;
  const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";

  const rows = await fetchAllPages((page, limit) =>
    fetchQuestionsFromDB(
      page,
      limit,
      search,
      startDate,
      endDate,
      sortBy,
      sortOrder,
      telemetryState,
    ),
  );

  return rows.map(formatQuestionData);
}

async function fetchFeedbackExportData({ startDate, endDate, filters, telemetryStateId }) {
  const telemetryState = getTelemetryState(telemetryStateId);
  const search = filters.search || "";
  const sortBy = filters.sortBy || null;
  const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";
  const feedbackSource = filters.feedbackSource || null;
  const feedbackType = filters.feedbackType || null;
  const channel = filters.channel || null;

  const rows = await fetchAllPages((page, limit) =>
    fetchAllFeedbackFromDB(
      page,
      limit,
      search,
      startDate,
      endDate,
      sortBy,
      sortOrder,
      feedbackSource,
      feedbackType,
      channel,
      telemetryState,
    ),
  );

  return rows.map(formatFeedbackData);
}

async function fetchAsrExportData({ startDate, endDate, filters, telemetryStateId }) {
  const { fetchAsrFromDB, formatAsrRecord } = require("../controllers/asr.controller");
  const telemetryState = getTelemetryState(telemetryStateId);
  const search = filters.search || "";
  const sortBy = filters.sortBy || null;
  const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";

  const rows = await fetchAllPages((page, limit) =>
    fetchAsrFromDB(
      page,
      limit,
      search,
      startDate,
      endDate,
      sortBy,
      sortOrder,
      telemetryState,
    ),
  );

  return rows.map(formatAsrRecord);
}

async function fetchTtsExportData({ startDate, endDate, filters, telemetryStateId }) {
  const { fetchTtsFromDB, formatTtsRecord } = require("../controllers/tts.controller");
  const telemetryState = getTelemetryState(telemetryStateId);
  const search = filters.search || "";
  const sortBy = filters.sortBy || null;
  const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";

  const rows = await fetchAllPages((page, limit) =>
    fetchTtsFromDB(
      page,
      limit,
      search,
      startDate,
      endDate,
      sortBy,
      sortOrder,
      telemetryState,
    ),
  );

  return rows.map(formatTtsRecord);
}

async function fetchNotificationsExportData({ startDate, endDate, filters, telemetryStateId }) {
  const telemetryState = getTelemetryState(telemetryStateId);
  const eventGroup = filters.eventGroup || "notification_api";
  const sortBy = filters.sortBy === "status_code" ? "status_code" : "event_time";
  const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
  const exactChannels = telemetryState?.exactChannels || [];
  const prefixChannels = telemetryState?.prefixChannels || [];

  if (eventGroup === "sessions") {
    const result = await pool.query(
      `
        WITH filtered_events AS (
          SELECT
            sid,
            fingerprint_id,
            event_name,
            response_count,
            COALESCE(event_time, to_timestamp(ets::double precision / 1000.0)) AS effective_event_time
          FROM ui_interaction_events
          WHERE event_name IS NOT NULL
            AND sid IS NOT NULL
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
            AND category IN ('notification', 'notification_feedback')
        )
        SELECT
          sid,
          MAX(fingerprint_id) FILTER (WHERE fingerprint_id IS NOT NULL) AS fingerprint_id,
          MAX(effective_event_time) AS session_time,
          COALESCE(SUM(response_count) FILTER (WHERE event_name = 'notification_api_response'), 0) AS total_notifications_returned,
          COUNT(*) FILTER (WHERE event_name = 'notification_bell') AS bell_clicks,
          COUNT(*) FILTER (WHERE event_name = 'notification_selected') AS notification_opens,
          COUNT(*) FILTER (WHERE event_name = 'notification_feedback_yes') AS like_count,
          COUNT(*) FILTER (WHERE event_name = 'notification_feedback_no') AS dislike_count,
          COUNT(*) FILTER (WHERE event_name = 'notification_feedback_dislike_submitted') AS negative_feedback_submitted
        FROM filtered_events
        GROUP BY sid
        ORDER BY session_time ${sortOrder} NULLS LAST, sid ${sortOrder}
      `,
      [exactChannels, prefixChannels, startTimestamp, endTimestamp],
    );

    return result.rows.map((row) => ({
      sid: row.sid,
      fingerprint_id: row.fingerprint_id,
      session_time: row.session_time,
      total_notifications_returned: row.total_notifications_returned,
      bell_clicks: row.bell_clicks,
      notification_opens: row.notification_opens,
      like_count: row.like_count,
      dislike_count: row.dislike_count,
      negative_feedback_submitted: row.negative_feedback_submitted,
    }));
  }

  const eventGroupFilters = {
    location: `category = 'location'`,
    notification_api: `category = 'notification' AND event_name = 'notification_api_response'`,
    notification_actions: `category = 'notification' AND event_name IN ('notification_bell', 'notification_selected', 'notification_mark_read')`,
    notification_feedback: `category = 'notification_feedback'`,
  };

  const groupFilter = eventGroupFilters[eventGroup] || eventGroupFilters.notification_api;
  const orderColumn = sortBy === "status_code" ? "status_code" : "event_time";

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
        created_at
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
        AND ${groupFilter}
      ORDER BY ${orderColumn} ${sortOrder} NULLS LAST, id ${sortOrder}
    `,
    [exactChannels, prefixChannels, startTimestamp, endTimestamp],
  );

  return result.rows;
}

async function fetchCallLogsExportData({ startDate, endDate, filters }) {
  const search = filters.search || "";
  const sortBy = filters.sortBy || null;
  const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  const SORT_MAP = {
    start_datetime: "c.start_datetime",
    start_date: "c.start_datetime",
    duration: "duration_in_seconds",
    duration_in_seconds: "duration_in_seconds",
    questions_count: "questions_count",
    total_interactions: "total_interactions",
    language_name: "c.language_name",
    num_messages: "c.num_messages",
    end_reason: "c.end_reason",
  };

  const conditions = [];
  const params = [];
  let idx = 0;

  if (startTimestamp !== null) {
    idx += 1;
    conditions.push(`c.start_datetime >= TO_TIMESTAMP($${idx} / 1000.0)`);
    params.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    idx += 1;
    conditions.push(`c.start_datetime <= TO_TIMESTAMP($${idx} / 1000.0)`);
    params.push(endTimestamp);
  }

  if (search) {
    idx += 1;
    const s = `%${search}%`;
    conditions.push(`(
      c.interaction_id ILIKE $${idx}
      OR c.user_contact_masked ILIKE $${idx}
      OR c.language_name ILIKE $${idx}
      OR c.end_reason ILIKE $${idx}
      OR c.current_language ILIKE $${idx}
    )`);
    params.push(s);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderColumn = SORT_MAP[sortBy] || "c.start_datetime";
  const orderClause = `ORDER BY ${orderColumn} ${sortOrder} NULLS LAST`;

  const sql = `
    SELECT
      c.id,
      c.interaction_id,
      c.user_id,
      c.user_contact_masked,
      c.connectivity_status,
      c.failure_reason,
      c.end_reason,
      COALESCE(NULLIF(c.duration_in_seconds, 0), EXTRACT(EPOCH FROM (c.end_datetime - c.start_datetime))) AS duration_in_seconds,
      to_char(${utcTimestampToIstTimestamp("c.start_datetime")}, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS start_datetime,
      to_char(${utcTimestampToIstTimestamp("c.end_datetime")}, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS end_datetime,
      c.language_name,
      c.current_language,
      c.num_messages,
      c.average_agent_response_time_in_seconds,
      c.average_user_response_time_in_seconds,
      c.channel_direction,
      c.channel_provider,
      c.channel_type,
      c.retry_attempt,
      c.is_debug_call,
      c.audio_url,
      c.has_log_issues,
      COUNT(m.id) AS total_interactions,
      COUNT(m.id) FILTER (WHERE m.role = 'user') AS questions_count
    FROM calls c
    LEFT JOIN messages m ON m.call_id = c.id
    ${whereClause}
    GROUP BY c.id
    ${orderClause}
  `;

  const { rows } = await pool.query(sql, params);

  return rows.map((row) => ({
    interactionId: row.interaction_id,
    userId: row.user_id,
    userContactMasked: row.user_contact_masked,
    connectivityStatus: row.connectivity_status,
    failureReason: row.failure_reason,
    endReason: row.end_reason,
    durationInSeconds: row.duration_in_seconds,
    startDatetime: row.start_datetime,
    endDatetime: row.end_datetime,
    languageName: row.language_name,
    currentLanguage: row.current_language,
    numMessages: row.num_messages,
    averageAgentResponseTime: row.average_agent_response_time_in_seconds,
    averageUserResponseTime: row.average_user_response_time_in_seconds,
    channelDirection: row.channel_direction,
    channelProvider: row.channel_provider,
    channelType: row.channel_type,
    retryAttempt: row.retry_attempt,
    isDebugCall: row.is_debug_call,
    audioUrl: row.audio_url,
    hasLogIssues: row.has_log_issues,
    questionsCount: row.questions_count,
    totalInteractions: row.total_interactions,
  }));
}

const MODULE_COLUMNS = {
  questions: [
    { key: "id", header: "ID" },
    { key: "qid", header: "Username" },
    { key: "fingerprint", header: "Fingerprint" },
    { key: "question", header: "Question" },
    { key: "answer", header: "Answer" },
    { key: "session_id", header: "Session ID" },
    { key: "channel", header: "Channel" },
    { key: "dateAsked", header: "Date Asked" },
  ],
  feedback: [
    { key: "id", header: "ID" },
    { key: "qid", header: "Question ID" },
    { key: "fingerprint", header: "Fingerprint" },
    { key: "question", header: "Question" },
    { key: "answer", header: "Answer" },
    { key: "rating", header: "Rating" },
    { key: "feedback", header: "Feedback" },
    { key: "feedbackSource", header: "Feedback Source" },
    { key: "channel", header: "Channel" },
    { key: "sessionId", header: "Session ID" },
    { key: "date", header: "Date" },
  ],
  notifications: [
    { key: "id", header: "ID" },
    { key: "sid", header: "Session ID" },
    { key: "fingerprint", header: "Fingerprint" },
    { key: "event_name", header: "Event Name" },
    { key: "category", header: "Category" },
    { key: "channel", header: "Channel" },
    { key: "event_time", header: "Event Time" },
    { key: "status_code", header: "Status Code" },
    { key: "success", header: "Success" },
    { key: "response_count", header: "Response Count" },
    { key: "notification_id", header: "Notification ID" },
    { key: "action", header: "Action" },
    { key: "feedback", header: "Feedback" },
    { key: "reason", header: "Reason" },
  ],
  "notifications-sessions": [
    { key: "sid", header: "Session ID" },
    { key: "fingerprint", header: "Fingerprint" },
    { key: "session_time", header: "Session Time" },
    { key: "total_notifications_returned", header: "Notifications Returned" },
    { key: "bell_clicks", header: "Bell Clicks" },
    { key: "notification_opens", header: "Notification Opens" },
    { key: "like_count", header: "Likes" },
    { key: "dislike_count", header: "Dislikes" },
    { key: "negative_feedback_submitted", header: "Negative Feedback Submitted" },
  ],
  asr: [
    { key: "id", header: "ID" },
    { key: "sid", header: "Session ID" },
    { key: "language", header: "Language" },
    { key: "text", header: "Text" },
    { key: "success", header: "Success" },
    { key: "latencyMs", header: "Latency (ms)" },
    { key: "statusCode", header: "Status Code" },
    { key: "errorCode", header: "Error Code" },
    { key: "errorMessage", header: "Error Message" },
    { key: "apiType", header: "API Type" },
    { key: "apiService", header: "API Service" },
    { key: "channel", header: "Channel" },
    { key: "createdAt", header: "Created At" },
  ],
  tts: [
    { key: "id", header: "ID" },
    { key: "sid", header: "Session ID" },
    { key: "language", header: "Language" },
    { key: "text", header: "Text" },
    { key: "success", header: "Success" },
    { key: "latencyMs", header: "Latency (ms)" },
    { key: "statusCode", header: "Status Code" },
    { key: "errorCode", header: "Error Code" },
    { key: "errorMessage", header: "Error Message" },
    { key: "apiType", header: "API Type" },
    { key: "apiService", header: "API Service" },
    { key: "channel", header: "Channel" },
    { key: "createdAt", header: "Created At" },
  ],
  "call-logs": [
    { key: "interactionId", header: "Interaction ID" },
    { key: "userId", header: "User ID" },
    { key: "userContactMasked", header: "User Contact" },
    { key: "startDatetime", header: "Start DateTime" },
    { key: "endDatetime", header: "End DateTime" },
    { key: "durationInSeconds", header: "Duration (seconds)" },
    { key: "languageName", header: "Language" },
    { key: "endReason", header: "End Reason" },
    { key: "questionsCount", header: "Questions Count" },
    { key: "totalInteractions", header: "Total Interactions" },
    { key: "channelProvider", header: "Channel Provider" },
    { key: "channelType", header: "Channel Type" },
  ],
};

async function fetchExportData(exportRecord) {
  const { module_name: moduleName, from_date: startDate, to_date: endDate, telemetry_state: telemetryStateId, filters } = exportRecord;
  const parsedFilters = typeof filters === "string" ? JSON.parse(filters) : (filters || {});

  switch (moduleName) {
    case "questions":
      return {
        rows: await fetchQuestionsExportData({ startDate, endDate, filters: parsedFilters, telemetryStateId }),
        columns: MODULE_COLUMNS.questions,
      };
    case "feedback":
      return {
        rows: await fetchFeedbackExportData({ startDate, endDate, filters: parsedFilters, telemetryStateId }),
        columns: MODULE_COLUMNS.feedback,
      };
    case "notifications": {
      const rows = await fetchNotificationsExportData({ startDate, endDate, filters: parsedFilters, telemetryStateId });
      const columns = parsedFilters.eventGroup === "sessions"
        ? MODULE_COLUMNS["notifications-sessions"]
        : MODULE_COLUMNS.notifications;
      return { rows, columns };
    }
    case "asr":
      return {
        rows: await fetchAsrExportData({ startDate, endDate, filters: parsedFilters, telemetryStateId }),
        columns: MODULE_COLUMNS.asr,
      };
    case "tts":
      return {
        rows: await fetchTtsExportData({ startDate, endDate, filters: parsedFilters, telemetryStateId }),
        columns: MODULE_COLUMNS.tts,
      };
    case "call-logs":
      return {
        rows: await fetchCallLogsExportData({ startDate, endDate, filters: parsedFilters }),
        columns: MODULE_COLUMNS["call-logs"],
      };
    default:
      throw new Error(`Unsupported module: ${moduleName}`);
  }
}

async function fetchExportPage(exportRecord, page, pageSize = EXPORT_PAGE_SIZE) {
  const {
    moduleName,
    startDate,
    endDate,
    telemetryStateId,
    filters,
  } = getExportContext(exportRecord);
  const telemetryState = getTelemetryState(telemetryStateId);
  const search = filters.search || "";
  const sortBy = filters.sortBy || null;
  const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";

  switch (moduleName) {
    case "questions": {
      const rows = await fetchQuestionsFromDB(
        page,
        pageSize,
        search,
        startDate,
        endDate,
        sortBy,
        sortOrder,
        telemetryState,
      );
      return rows.map(formatQuestionData);
    }
    case "feedback": {
      const rows = await fetchAllFeedbackFromDB(
        page,
        pageSize,
        search,
        startDate,
        endDate,
        sortBy,
        sortOrder,
        filters.feedbackSource || null,
        filters.feedbackType || null,
        filters.channel || null,
        telemetryState,
      );
      return rows.map(formatFeedbackData);
    }
    case "asr": {
      const { fetchAsrFromDB, formatAsrRecord } = require("../controllers/asr.controller");
      const rows = await fetchAsrFromDB(
        page,
        pageSize,
        search,
        startDate,
        endDate,
        sortBy,
        sortOrder,
        telemetryState,
      );
      return rows.map(formatAsrRecord);
    }
    case "tts": {
      const { fetchTtsFromDB, formatTtsRecord } = require("../controllers/tts.controller");
      const rows = await fetchTtsFromDB(
        page,
        pageSize,
        search,
        startDate,
        endDate,
        sortBy,
        sortOrder,
        telemetryState,
      );
      return rows.map(formatTtsRecord);
    }
    case "notifications":
      if (page > 1) {
        return [];
      }
      return fetchNotificationsExportData({
        startDate,
        endDate,
        filters,
        telemetryStateId,
      });
    case "call-logs":
      if (page > 1) {
        return [];
      }
      return fetchCallLogsExportData({ startDate, endDate, filters });
    default:
      throw new Error(`Unsupported module: ${moduleName}`);
  }
}

async function writeExportCsvToFile(exportRecord, filePath) {
  const { maskApiResponse } = require("../utils/piiMasking");
  const { csvHeaderLine, rowToCsvLine } = require("../utils/csvUtils");
  const { pruneEmptyExportColumns } = require("../utils/xlsxExport");
  const filters = getParsedFilters(exportRecord);
  const baseColumns = getExportColumns(exportRecord, filters);

  const prepareRows = async (page, pageSize) => {
    const rows = await fetchExportPage(exportRecord, page, pageSize);
    return enrichExportRows(
      rows.map((row) => maskApiResponse(row)),
      exportRecord,
    );
  };

  const firstPageRows = await prepareRows(1, EXPORT_PAGE_SIZE);
  const columns = pruneEmptyExportColumns(baseColumns, firstPageRows);

  const fileHandle = fs.openSync(filePath, "w");
  let totalRows = 0;

  try {
    fs.writeSync(fileHandle, `\uFEFF${csvHeaderLine(columns)}\n`);

    let page = 1;
    while (totalRows < MAX_EXPORT_ROWS) {
      const rows = page === 1 ? firstPageRows : await prepareRows(page, EXPORT_PAGE_SIZE);
      if (!rows.length) {
        break;
      }

      const chunk = rows
        .map((row) => rowToCsvLine(row, columns))
        .join("\n");

      fs.writeSync(fileHandle, `${chunk}\n`);
      totalRows += rows.length;

      console.log(
        `[Export] ${exportRecord.id} page ${page}: ${rows.length} rows (total ${totalRows})`,
      );

      if (rows.length < EXPORT_PAGE_SIZE) {
        break;
      }

      page += 1;
    }

    if (totalRows >= MAX_EXPORT_ROWS) {
      throw new Error(`Export exceeds maximum of ${MAX_EXPORT_ROWS.toLocaleString()} rows`);
    }
  } finally {
    fs.closeSync(fileHandle);
  }

  return totalRows;
}

async function writeExportXlsxToFile(exportRecord, filePath) {
  const { maskApiResponse } = require("../utils/piiMasking");
  const { writeFormattedXlsx } = require("../utils/xlsxExport");
  const filters = getParsedFilters(exportRecord);
  const columns = getExportColumns(exportRecord, filters);

  return writeFormattedXlsx({
    filePath,
    columns,
    maxRows: MAX_EXPORT_ROWS,
    pageSize: EXPORT_PAGE_SIZE,
    fetchPage: async (page, pageSize) => {
      const rows = await fetchExportPage(exportRecord, page, pageSize);
      return enrichExportRows(
        rows.map((row) => maskApiResponse(row)),
        exportRecord,
      );
    },
    onPageWritten: (page, pageRows, totalRows) => {
      console.log(
        `[Export] ${exportRecord.id} page ${page}: ${pageRows} rows (total ${totalRows})`,
      );
    },
  });
}

module.exports = {
  fetchExportData,
  writeExportCsvToFile,
  writeExportXlsxToFile,
  MODULE_COLUMNS,
};
