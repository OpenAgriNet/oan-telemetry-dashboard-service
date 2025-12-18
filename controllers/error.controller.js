const pool = require("../services/db");
const { formatUTCToISTDateTime, parseDateRange } = require("../utils/dateUtils");

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
            uid as user_id,
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

  // Add date range filtering using created_at
  if (startTimestamp !== null) {
    paramIndex++;
    query += ` AND created_at >= $${paramIndex}`;
    queryParams.push(new Date(startTimestamp));
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND created_at <= $${paramIndex}`;
    queryParams.push(new Date(endTimestamp));
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

     const sortArray = ["created_at", "user_id", "session_id", "error_message"];
  // console.log("SortBy:", sortBy, "SortOrder:", sortOrder);
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
    query += ` AND created_at >= $${paramIndex}`;
    queryParams.push(new Date(startTimestamp));
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND created_at <= $${paramIndex}`;
    queryParams.push(new Date(endTimestamp));
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

  let query = `
        SELECT 
            COUNT(*) as total_errors,
            COUNT(DISTINCT uid) as unique_users,
            COUNT(DISTINCT sid) as unique_sessions,
            COUNT(DISTINCT channel) as unique_channels
        FROM errordetails
        WHERE errortext IS NOT NULL
    `;

  const queryParams = [];
  let paramIndex = 0;

  // Add date range filtering
  if (startTimestamp !== null) {
    paramIndex++;
    query += ` AND created_at >= $${paramIndex}`;
    queryParams.push(new Date(startTimestamp));
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND created_at <= $${paramIndex}`;
    queryParams.push(new Date(endTimestamp));
  }

  // Add search filter if search term is provided
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
    unresolvedErrors: parseInt(result.rows[0].total_errors) || 0, // All errors are considered unresolved
    resolvedErrors: 0, // No resolved errors in this table structure
    criticalErrors: parseInt(result.rows[0].total_errors) || 0, // Consider all as critical for now
    avgErrorCount: 1, // Each row is one error occurrence
    uniqueUsers: parseInt(result.rows[0].unique_users) || 0,
    uniqueSessions: parseInt(result.rows[0].unique_sessions) || 0,
    uniqueChannels: parseInt(result.rows[0].unique_channels) || 0,
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
    // console.log(
    //   `Fetching errors - Page: ${page}, Limit: ${limit}, Search: "${search}", StartDate: ${startDate}, EndDate: ${endDate}, ErrorType: ${errorType} sortBy: ${sortBy}, sortOrder: ${sortOrder}`
    // );

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
            uid as user_id,
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
            uid as user_id,
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
    query += ` AND created_at >= $${paramIndex}`;
    queryParams.push(new Date(startTimestamp));
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND created_at <= $${paramIndex}`;
    queryParams.push(new Date(endTimestamp));
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
    query += ` AND created_at >= $${paramIndex}`;
    queryParams.push(new Date(startTimestamp));
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND created_at <= $${paramIndex}`;
    queryParams.push(new Date(endTimestamp));
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

// Controller function to get error graph data
const getErrorGraph = async (req, res) => {
  try {
    const { startDate, endDate, granularity = "day" } = req.query;
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

    let dateFormat, dateInterval;
    switch (granularity) {
      case "hour":
        dateFormat = "YYYY-MM-DD HH24:00:00";
        dateInterval = "1 hour";
        break;
      case "day":
        dateFormat = "YYYY-MM-DD";
        dateInterval = "1 day";
        break;
      case "week":
        dateFormat = 'YYYY-"W"WW';
        dateInterval = "1 week";
        break;
      case "month":
        dateFormat = "YYYY-MM";
        dateInterval = "1 month";
        break;
      default:
        dateFormat = "YYYY-MM-DD";
        dateInterval = "1 day";
    }

    let query = `
            WITH date_series AS (
                SELECT generate_series(
                    date_trunc('${granularity}', $1::timestamp),
                    date_trunc('${granularity}', $2::timestamp),
                    interval '${dateInterval}'
                ) AS date_period
            ),
            error_counts AS (
                SELECT 
                    date_trunc('${granularity}', created_at) as error_period,
                    COUNT(*) as error_count,
                    COUNT(DISTINCT uid) as unique_users,
                    COUNT(DISTINCT sid) as unique_sessions,
                    COUNT(DISTINCT channel) as unique_channels
                FROM errordetails
                WHERE created_at >= $1 AND created_at <= $2 AND errortext IS NOT NULL
                GROUP BY date_trunc('${granularity}', created_at)
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

    const queryParams = [];
    if (startTimestamp !== null && endTimestamp !== null) {
      queryParams.push(new Date(startTimestamp), new Date(endTimestamp));
    } else {
      // Default to last 30 days if no date range provided
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      queryParams.push(startDate, endDate);
    }

    const result = await pool.query(query, queryParams);

    const graphData = result.rows.map((row) => ({
      date: row.date_period,
      errorCount: parseInt(row.error_count),
      criticalCount: parseInt(row.critical_count),
      unresolvedCount: parseInt(row.unresolved_count),
      uniqueUsers: parseInt(row.unique_users),
      uniqueSessions: parseInt(row.unique_sessions),
      uniqueChannels: parseInt(row.unique_channels),
    }));

    res.json({ data: graphData });
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

    console.log(
      `Found ${errorsData.length} errors for session ${sessionId.trim()}`
    );

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
