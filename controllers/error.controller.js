const pool = require("../services/db");
const { formatUTCToISTDateTime, parseDateRange } = require("../utils/dateUtils");
const { mvExists } = require("../utils/mvHealth");

async function fetchAllErrorsFromDB(
  page = 1,
  limit = 10,
  search = "",
  startDate = null,
  endDate = null,
  errorType = "",
  sortBy = null,
  sortOrder = "DESC"
) {
  const offset = (page - 1) * limit;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  // Base query using actual errordetails table structure
  let query = `
        SELECT 
            id,
            fingerprint_id as user_id,
            sid as session_id,
            qid as question_id,
            errortext as error_message,
            groupdetails,
            channel,
            ets,
            created_at
        FROM errordetails
        WHERE errortext IS NOT NULL
    `;

  const queryParams = [];
  let paramIndex = 0;

  // Add date range filtering using ets (Unix milliseconds)
  if (startTimestamp !== null) {
    paramIndex++;
    query += ` AND ets >= $${paramIndex}`;
    queryParams.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND ets <= $${paramIndex}`;
    queryParams.push(endTimestamp);
  }

  // Add search functionality if search term is provided
  if (search && search.trim() !== "") {
    paramIndex++;
    query += ` AND (
            errortext ILIKE $${paramIndex} OR 
            channel ILIKE $${paramIndex} OR 
            uid ILIKE $${paramIndex} OR
            sid ILIKE $${paramIndex} OR
            qid ILIKE $${paramIndex}
        )`;
    queryParams.push(`%${search.trim()}%`);
  }

  const sortArray = ["created_at", "user_id", "session_id", "error_message", "ets"];
  if (sortArray.includes(sortBy)) {
    query += ` ORDER BY ${sortBy} ${sortOrder}`;
  } else {
    query += ` ORDER BY created_at DESC`;
  }

  // Add pagination
  paramIndex++;
  query += ` LIMIT $${paramIndex}`;
  queryParams.push(limit);

  paramIndex++;
  query += ` OFFSET $${paramIndex}`;
  queryParams.push(offset);

  const result = await pool.query(query, queryParams);
  return result.rows;
}

async function getTotalErrorCount(
  search = "",
  startDate = null,
  endDate = null,
  errorType = ""
) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  let query = `
        SELECT COUNT(*) as total
        FROM errordetails
        WHERE errortext IS NOT NULL
    `;

  const queryParams = [];
  let paramIndex = 0;

  // Add date range filtering
  if (startTimestamp !== null) {
    paramIndex++;
    query += ` AND ets >= $${paramIndex}`;
    queryParams.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND ets <= $${paramIndex}`;
    queryParams.push(endTimestamp);
  }

  // Add search filter to count query if search term is provided
  if (search && search.trim() !== "") {
    paramIndex++;
    query += ` AND (
            errortext ILIKE $${paramIndex} OR 
            channel ILIKE $${paramIndex} OR 
            uid ILIKE $${paramIndex} OR
            sid ILIKE $${paramIndex} OR
            qid ILIKE $${paramIndex}
        )`;
    queryParams.push(`%${search.trim()}%`);
  }

  const result = await pool.query(query, queryParams);
  return parseInt(result.rows[0].total);
}

async function getErrorStats(search = "", startDate = null, endDate = null) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  // MV-first: when no search and a date range is present, read mv_errors_daily.
  if (!search && startTimestamp !== null && endTimestamp !== null && await mvExists('mv_errors_daily')) {
    try {
      const mvRes = await pool.query(
        `SELECT
           COALESCE(SUM(error_count), 0) AS total_errors,
           COALESCE(SUM(unique_users), 0) AS unique_users,
           COALESCE(SUM(unique_sessions), 0) AS unique_sessions,
           COALESCE(COUNT(DISTINCT channel), 0) AS unique_channels
         FROM mv_errors_daily
         WHERE error_date >= DATE(TO_TIMESTAMP($1::bigint / 1000) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
           AND error_date <= DATE(TO_TIMESTAMP($2::bigint / 1000) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')`,
        [startTimestamp, endTimestamp]
      );
      const row = mvRes.rows[0];
      const total = parseInt(row.total_errors) || 0;
      return {
        totalErrors: total,
        unresolvedErrors: total,
        resolvedErrors: 0,
        criticalErrors: total,
        avgErrorCount: 1,
        uniqueUsers: parseInt(row.unique_users) || 0,
        uniqueSessions: parseInt(row.unique_sessions) || 0,
        uniqueChannels: parseInt(row.unique_channels) || 0,
        source: 'mv',
      };
    } catch (mvErr) {
      console.warn('[ErrorStats] MV query failed, falling back:', mvErr.message);
    }
  }

  let query = `
        SELECT
            COUNT(*) as total_errors,
            COUNT(DISTINCT fingerprint_id) as unique_users,
            COUNT(DISTINCT sid) as unique_sessions,
            COUNT(DISTINCT channel) as unique_channels
        FROM errordetails
        WHERE errortext IS NOT NULL
    `;

  const queryParams = [];
  let paramIndex = 0;

  if (startTimestamp !== null) {
    paramIndex++;
    query += ` AND ets >= $${paramIndex}`;
    queryParams.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND ets <= $${paramIndex}`;
    queryParams.push(endTimestamp);
  }

  if (search && search.trim() !== "") {
    paramIndex++;
    query += ` AND (
            errortext ILIKE $${paramIndex} OR
            channel ILIKE $${paramIndex} OR
            uid ILIKE $${paramIndex}
        )`;
    queryParams.push(`%${search.trim()}%`);
  }

  const result = await pool.query(query, queryParams);
  return {
    totalErrors: parseInt(result.rows[0].total_errors) || 0,
    unresolvedErrors: parseInt(result.rows[0].total_errors) || 0,
    resolvedErrors: 0,
    criticalErrors: parseInt(result.rows[0].total_errors) || 0,
    avgErrorCount: 1,
    uniqueUsers: parseInt(result.rows[0].unique_users) || 0,
    uniqueSessions: parseInt(result.rows[0].unique_sessions) || 0,
    uniqueChannels: parseInt(result.rows[0].unique_channels) || 0,
    source: 'base',
  };
}

function formatErrorData(errorItem) {
  const dateObj = new Date(errorItem.created_at);

  // Use utility function to format UTC to IST
  const istDateTime = formatUTCToISTDateTime(dateObj);

  return {
    id: errorItem.id,
    errorType: "Application Error", // Generic type since not specified in table
    errorMessage: errorItem.error_message || "No error message available",
    errorStack: null, // Not available in current table
    userId: errorItem.user_id,
    sessionId: errorItem.session_id,
    questionId: errorItem.question_id,
    endpoint: null, // Not available in current table
    method: null, // Not available in current table
    statusCode: null, // Not available in current table
    requestData: errorItem.groupdetails, // Use groupdetails as request context
    userAgent: null, // Not available in current table
    ipAddress: null, // Not available in current table
    date: istDateTime.date,
    time: istDateTime.time,
    fullDate: istDateTime.fullDate, // Original UTC timestamp
    resolved: false, // No resolution tracking in current table
    resolvedAt: null,
    resolvedBy: null,
    errorCount: 1, // Each row represents one occurrence
    lastOccurrence: istDateTime.fullDate, // Original UTC timestamp
    environment: "production", // Default environment
    channel: errorItem.channel,
    ets: errorItem.ets,
  };
}

// Controller function to get all errors with pagination
async function getAllErrors(req, res) {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      startDate,
      endDate,
      errorType = "",
      sortBy,
      sortOrder = req.query.sortOrder === "asc" ? "ASC" : "DESC"
    } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;

    // Validate page and limit
    if (pageNum < 1 || limitNum < 1 || limitNum > 1000) {
      return res.status(400).json({
        error:
          "Invalid pagination parameters. Page must be >= 1 and limit must be between 1 and 100.",
      });
    }

    // Fetch errors from database
    const errors = await fetchAllErrorsFromDB(
      pageNum,
      limitNum,
      search,
      startDate,
      endDate,
      errorType,
      sortBy,
      sortOrder
    );

    // Get total count for pagination
    const totalCount = await getTotalErrorCount(
      search,
      startDate,
      endDate,
      errorType
    );

    // Format error data
    const formattedErrors = errors.map(formatErrorData);

    const totalPages = Math.ceil(totalCount / limitNum);

    res.json({
      data: formattedErrors,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        hasNextPage: pageNum < totalPages,
        hasPreviousPage: pageNum > 1,
      },
      total: totalCount,
    });
  } catch (error) {
    console.error("Error fetching errors:", error);
    res.status(500).json({
      error: "Internal server error while fetching errors",
      details: error.message,
    });
  }
}

// Controller function to get error by ID
async function fetchErrorByIdFromDB(id) {
  const query = `
        SELECT 
            id,
            fingerprint_id as user_id,
            sid as session_id,
            qid as question_id,
            errortext as error_message,
            groupdetails,
            channel,
            ets,
            created_at
        FROM errordetails 
        WHERE id = $1
    `;

  const result = await pool.query(query, [id]);
  return result.rows[0];
}

async function fetchErrorsBySessionIdFromDB(
  sessionId,
  page = 1,
  limit = 10,
  startDate = null,
  endDate = null
) {
  const offset = (page - 1) * limit;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  let query = `
        SELECT 
            id,
            fingerprint_id as user_id,
            sid as session_id,
            qid as question_id,
            errortext as error_message,
            groupdetails,
            channel,
            ets,
            created_at
        FROM errordetails
        WHERE sid = $1 AND errortext IS NOT NULL
    `;

  const queryParams = [sessionId];
  let paramIndex = 1;

  // Add date range filtering
  if (startTimestamp !== null) {
    paramIndex++;
    query += ` AND ets >= $${paramIndex}`;
    queryParams.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND ets <= $${paramIndex}`;
    queryParams.push(endTimestamp);
  }

  query += ` ORDER BY created_at DESC`;

  // Add pagination
  paramIndex++;
  query += ` LIMIT $${paramIndex}`;
  queryParams.push(limit);

  paramIndex++;
  query += ` OFFSET $${paramIndex}`;
  queryParams.push(offset);

  const result = await pool.query(query, queryParams);
  return result.rows;
}

async function getTotalErrorsCountBySession(
  sessionId,
  startDate = null,
  endDate = null
) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  let query = `
        SELECT COUNT(*) as total
        FROM errordetails
        WHERE sid = $1 AND errortext IS NOT NULL
    `;

  const queryParams = [sessionId];
  let paramIndex = 1;

  // Add date range filtering
  if (startTimestamp !== null) {
    paramIndex++;
    query += ` AND ets >= $${paramIndex}`;
    queryParams.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND ets <= $${paramIndex}`;
    queryParams.push(endTimestamp);
  }

  const result = await pool.query(query, queryParams);
  return parseInt(result.rows[0].total);
}

async function getErrorById(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Error ID is required" });
    }

    const error = await fetchErrorByIdFromDB(id);

    if (!error) {
      return res.status(404).json({ error: "Error not found" });
    }

    const formattedError = formatErrorData(error);

    res.json({
      data: formattedError,
    });
  } catch (error) {
    console.error("Error fetching error by ID:", error);
    res.status(500).json({
      error: "Internal server error while fetching error details",
      details: error.message,
    });
  }
}

// Controller function to get error statistics
const getErrorStatistics = async (req, res) => {
  try {
    const { search = "", startDate, endDate } = req.query;

    const stats = await getErrorStats(search, startDate, endDate);

    res.json(stats);
  } catch (error) {
    console.error("Error fetching error statistics:", error);
    res.status(500).json({
      error: "Internal server error while fetching error statistics",
      details: error.message,
    });
  }
};

// Controller function to get error graph data.
// SECURITY: granularity is now whitelisted (previous version interpolated
// the raw query param into SQL strings inside date_trunc() and interval).
const getErrorGraph = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const rawGranularity = String(req.query.granularity || "day").toLowerCase();
    const GRANULARITY_MAP = {
      hour:  { trunc: 'hour',  interval: '1 hour' },
      day:   { trunc: 'day',   interval: '1 day' },
      week:  { trunc: 'week',  interval: '1 week' },
      month: { trunc: 'month', interval: '1 month' },
    };
    const granCfg = GRANULARITY_MAP[rawGranularity] || GRANULARITY_MAP.day;
    const granularity = Object.keys(GRANULARITY_MAP).find(k => GRANULARITY_MAP[k] === granCfg);

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

    const queryParams = [];
    if (startTimestamp !== null && endTimestamp !== null) {
      queryParams.push(startTimestamp, endTimestamp);
    } else {
      const endMs = Date.now();
      const startMs = endMs - (30 * 24 * 60 * 60 * 1000);
      queryParams.push(startMs, endMs);
    }

    // MV fast-path: daily granularity via mv_errors_daily.
    let graphData = null;
    let source = 'base';
    if (granularity === 'day' && await mvExists('mv_errors_daily')) {
      try {
        const mvSql = `
          WITH date_series AS (
            SELECT generate_series(
              date_trunc('day', TO_TIMESTAMP($1::bigint / 1000)),
              date_trunc('day', TO_TIMESTAMP($2::bigint / 1000)),
              interval '1 day'
            )::date AS date_period
          )
          SELECT
            ds.date_period,
            COALESCE(SUM(m.error_count), 0) AS error_count,
            COALESCE(SUM(m.error_count), 0) AS critical_count,
            COALESCE(SUM(m.error_count), 0) AS unresolved_count,
            COALESCE(SUM(m.unique_users), 0) AS unique_users,
            COALESCE(SUM(m.unique_sessions), 0) AS unique_sessions,
            COUNT(DISTINCT m.channel) AS unique_channels
          FROM date_series ds
          LEFT JOIN mv_errors_daily m ON m.error_date = ds.date_period
          GROUP BY ds.date_period
          ORDER BY ds.date_period
        `;
        const mvResult = await pool.query(mvSql, queryParams);
        graphData = mvResult.rows.map((row) => ({
          date: row.date_period,
          errorCount: parseInt(row.error_count),
          criticalCount: parseInt(row.critical_count),
          unresolvedCount: parseInt(row.unresolved_count),
          uniqueUsers: parseInt(row.unique_users),
          uniqueSessions: parseInt(row.unique_sessions),
          uniqueChannels: parseInt(row.unique_channels),
        }));
        source = 'mv';
      } catch (mvErr) {
        console.warn('[ErrorGraph] MV query failed, falling back:', mvErr.message);
        graphData = null;
      }
    }

    if (!graphData) {
      // Parameters for date_trunc granularity are taken from the whitelist
      // (granCfg.trunc / granCfg.interval) — NOT from req.query directly.
      const query = `
        WITH date_series AS (
          SELECT generate_series(
            date_trunc('${granCfg.trunc}', TO_TIMESTAMP($1::bigint / 1000)),
            date_trunc('${granCfg.trunc}', TO_TIMESTAMP($2::bigint / 1000)),
            interval '${granCfg.interval}'
          ) AS date_period
        ),
        error_counts AS (
          SELECT
            date_trunc('${granCfg.trunc}', created_at) as error_period,
            COUNT(*) as error_count,
            COUNT(DISTINCT uid) as unique_users,
            COUNT(DISTINCT sid) as unique_sessions,
            COUNT(DISTINCT channel) as unique_channels
          FROM errordetails
          WHERE ets >= $1 AND ets <= $2 AND errortext IS NOT NULL
          GROUP BY date_trunc('${granCfg.trunc}', created_at)
        )
        SELECT
          ds.date_period,
          COALESCE(ec.error_count, 0) as error_count,
          COALESCE(ec.error_count, 0) as critical_count,
          COALESCE(ec.error_count, 0) as unresolved_count,
          COALESCE(ec.unique_users, 0) as unique_users,
          COALESCE(ec.unique_sessions, 0) as unique_sessions,
          COALESCE(ec.unique_channels, 0) as unique_channels
        FROM date_series ds
        LEFT JOIN error_counts ec ON ds.date_period = ec.error_period
        ORDER BY ds.date_period
      `;
      const result = await pool.query(query, queryParams);
      graphData = result.rows.map((row) => ({
        date: row.date_period,
        errorCount: parseInt(row.error_count),
        criticalCount: parseInt(row.critical_count),
        unresolvedCount: parseInt(row.unresolved_count),
        uniqueUsers: parseInt(row.unique_users),
        uniqueSessions: parseInt(row.unique_sessions),
        uniqueChannels: parseInt(row.unique_channels),
      }));
    }

    res.json({ data: graphData, meta: { source } });
  } catch (error) {
    console.error("Error fetching error graph data:", error);
    res.status(500).json({
      error: "Internal server error while fetching error graph data",
      details: error.message,
    });
  }
};

// Controller function to get errors by session ID
const getErrorsBySessionId = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId || sessionId.trim() === "") {
      return res.status(400).json({
        error: "Session ID is required and cannot be empty",
      });
    }

    // Extract and sanitize pagination parameters
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    // Validate date range
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res.status(400).json({
        error:
          "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }

    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res.status(400).json({
        error: "Start date cannot be after end date",
      });
    }

    // Fetch errors for the session and total count
    const [errorsData, totalCount] = await Promise.all([
      fetchErrorsBySessionIdFromDB(
        sessionId.trim(),
        page,
        limit,
        startDate,
        endDate
      ),
      getTotalErrorsCountBySession(sessionId.trim(), startDate, endDate),
    ]);

    // Format error data
    const formattedData = errorsData.map(formatErrorData);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    res.status(200).json({
      data: formattedData,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalCount: totalCount,
        hasNextPage: hasNextPage,
        hasPreviousPage: hasPreviousPage,
      },
      filters: {
        sessionId: sessionId.trim(),
        startDate: startDate,
        endDate: endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching errors by session ID:", error);
    res.status(500).json({
      error: "Error fetching session errors",
      details: error.message,
    });
  }
};

module.exports = {
  getAllErrors,
  getErrorById,
  getErrorStatistics,
  getErrorGraph,
  fetchAllErrorsFromDB,
  formatErrorData,
  getErrorsBySessionId,
};
