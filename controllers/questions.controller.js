const pool = require("../services/db"); // Ensure this path is correct
const { parseDateRange, formatDateToIST, getCurrentTimestamp } = require("../utils/dateUtils");

async function fetchQuestionsFromDB(
  page = 1,
  limit = 10,
  search = "",
  startDate = null,
  endDate = null,
  sortBy = null, 
  sortOrder = "DESC"
) {
  const offset = (page - 1) * limit;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  // Base query with optional search and date filtering - using parameterized queries
  let query = `
        SELECT 
            id,
            uid as qid,
            questiontext AS question,
            answertext AS answer,
            uid AS user_id,
            created_at,
            ets,
            channel,
            sid AS session_id
        FROM questions
        WHERE uid IS NOT NULL AND answertext IS NOT NULL
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

  // Filter out future ETS records (bad telemetry data)
  paramIndex++;
  query += ` AND ets <= $${paramIndex}`;
  queryParams.push(Date.now());

  // Add search functionality if search term is provided
  if (search && search.trim() !== "") {
    paramIndex++;
    query += ` AND (
            questiontext ILIKE $${paramIndex} OR 
            answertext ILIKE $${paramIndex} OR
            uid ILIKE $${paramIndex} OR
            channel ILIKE $${paramIndex} OR
            farmer_id ILIKE $${paramIndex} OR
            unique_id ILIKE $${paramIndex}
        )`;
    queryParams.push(`%${search.trim()}%`);
  }

  const sortArray = ["id", "user_id", "session_id", "dateAsked"];
  if (sortArray.includes(sortBy)) {
    query += ` ORDER BY ${sortBy === "dateAsked" ? "ets" : sortBy} ${sortOrder}`;
  } else {
    query += ` ORDER BY ets DESC`;
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

async function getTotalQuestionsCount(
  search = "",
  startDate = null,
  endDate = null
) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  let query = `
        SELECT COUNT(*) as total
        FROM questions
        WHERE uid IS NOT NULL AND answertext IS NOT NULL
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
            questiontext ILIKE $${paramIndex} OR 
            answertext ILIKE $${paramIndex} OR
            uid ILIKE $${paramIndex} OR
            channel ILIKE $${paramIndex} OR
            farmer_id ILIKE $${paramIndex} OR
            unique_id ILIKE $${paramIndex}
        )`;
    queryParams.push(`%${search.trim()}%`);
  }

  const result = await pool.query(query, queryParams);
  return parseInt(result.rows[0].total);
}

function formatQuestionData(row) {
  let dateAsked = null;

  try {
    if (row.ets) {
      // First try to parse the timestamp if it's in milliseconds
      const timestamp = parseInt(row.ets);
      if (!isNaN(timestamp)) {
        // Convert to IST timezone
        dateAsked = formatDateToIST(timestamp);
      } else {
        // If not a timestamp, try parsing as a date string
        const parsedDate = new Date(row.ets);
        dateAsked = formatDateToIST(parsedDate.getTime());
      }
    }
  } catch (err) {
    console.warn("Could not parse date:", row.ets);
    dateAsked = null;
  }

  return {
    ...row,
    dateAsked,
    hasVoiceInput: false,
    reaction: "neutral",
    timestamp: row.ets,
  };
}

const getQuestions = async (req, res) => {
  try {
    // Extract and sanitize pagination parameters from query string
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    const sortBy = req.query.sortBy;
    const sortOrder = req.query.sortOrder === "asc" ? "ASC" : "DESC";

    // Additional validation for search term length to prevent abuse
    if (search.length > 1000) {
      return res.status(400).json({
        success: false,
        error: "Search term too long",
      });
    }

    // Validate date range
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }

    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res.status(400).json({
        success: false,
        error: "Start date cannot be after end date",
      });
    }

    // Fetch paginated questions data and total count
    const [questionsData, totalCount] = await Promise.all([
      fetchQuestionsFromDB(page, limit, search, startDate, endDate, sortBy, sortOrder),
      getTotalQuestionsCount(search, startDate, endDate),
    ]);

    const formattedData = questionsData.map(formatQuestionData);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Return paginated response
    res.status(200).json({
      success: true,
      data: formattedData,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage: hasNextPage,
        hasPreviousPage: hasPreviousPage,
        nextPage: hasNextPage ? page + 1 : null,
        previousPage: hasPreviousPage ? page - 1 : null,
      },
      filters: {
        search: search,
        startDate: startDate,
        endDate: endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching questions:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// Get single question by ID
const getQuestionById = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format to prevent SQL injection
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!id || !uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Valid UUID ID is required",
      });
    }

    const query = {
      text: `
                SELECT 
                    id,
                    uid as qid,
                    questiontext AS question,
                    answertext AS answer,
                    uid AS user_id,
                    created_at,
                    ets,
                    channel,
                    sid AS session_id,
                    groupdetails,
                    questionsource
                FROM questions
                WHERE id = $1
            `,
      values: [id],
    };

    const result = await pool.query(query);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No question found for the given ID",
      });
    }

    const formattedQuestion = formatQuestionData(result.rows[0]);

    res.status(200).json({
      success: true,
      data: formattedQuestion,
    });
  } catch (error) {
    console.error("Error fetching question by ID:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching question data",
    });
  }
};

// Get questions by user ID with date filtering
const getQuestionsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const offset = (page - 1) * limit;

    if (!userId || typeof userId !== "string" || userId.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Valid User ID is required",
      });
    }

    // Validate date range
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }

    // Build date filtering for questions query
    let dateFilter = "";
    let countDateFilter = "";
    const queryParams = [userId.trim()];
    const countParams = [userId.trim()];
    let paramIndex = 1;

    if (startTimestamp !== null) {
      paramIndex++;
      dateFilter += ` AND ets >= $${paramIndex}`;
      countDateFilter += ` AND ets >= $${paramIndex}`;
      queryParams.push(startTimestamp);
      countParams.push(startTimestamp);
    }

    if (endTimestamp !== null) {
      paramIndex++;
      dateFilter += ` AND ets <= $${paramIndex}`;
      countDateFilter += ` AND ets <= $${paramIndex}`;
      queryParams.push(endTimestamp);
      countParams.push(endTimestamp);
    }

    // Add pagination params
    queryParams.push(limit, offset);

    // Get questions by user ID with pagination and date filtering
    const questionsQuery = {
      text: `
                SELECT 
                    id,
                    uid as qid,
                    questiontext AS question,
                    answertext AS answer,
                    uid AS user_id,
                    created_at,
                    ets,
                    channel,
                    sid AS session_id
                FROM questions
                WHERE uid = $1 
                    AND questiontext IS NOT NULL 
                    AND answertext IS NOT NULL
                    ${dateFilter}
                    AND ets <= ${Date.now()}
                ORDER BY ets DESC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `,
      values: queryParams,
    };

    // Get total count for user with date filtering
    const countQuery = {
      text: `
                SELECT COUNT(*) as total
                FROM questions
                WHERE uid = $1 
                    AND questiontext IS NOT NULL 
                    AND answertext IS NOT NULL
                    ${countDateFilter}
            `,
      values: countParams,
    };

    const [questionsResult, countResult] = await Promise.all([
      pool.query(questionsQuery),
      pool.query(countQuery),
    ]);

    const totalCount = parseInt(countResult.rows[0].total);
    const formattedData = questionsResult.rows.map(formatQuestionData);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    res.status(200).json({
      success: true,
      data: formattedData,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage: hasNextPage,
        hasPreviousPage: hasPreviousPage,
        nextPage: hasNextPage ? page + 1 : null,
        previousPage: hasPreviousPage ? page - 1 : null,
      },
      filters: {
        userId: userId.trim(),
        startDate: startDate,
        endDate: endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching questions by user ID:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching user questions",
    });
  }
};

// Get questions by session ID with date filtering
const getQuestionsBySessionId = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const offset = (page - 1) * limit;

    if (
      !sessionId ||
      typeof sessionId !== "string" ||
      sessionId.trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        error: "Valid Session ID is required",
      });
    }

    // Validate date range
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }

    // Build date filtering for questions query
    let dateFilter = "";
    let countDateFilter = "";
    const queryParams = [sessionId.trim()];
    const countParams = [sessionId.trim()];
    let paramIndex = 1;

    if (startTimestamp !== null) {
      paramIndex++;
      dateFilter += ` AND ets >= $${paramIndex}`;
      countDateFilter += ` AND ets >= $${paramIndex}`;
      queryParams.push(startTimestamp);
      countParams.push(startTimestamp);
    }

    if (endTimestamp !== null) {
      paramIndex++;
      dateFilter += ` AND ets <= $${paramIndex}`;
      countDateFilter += ` AND ets <= $${paramIndex}`;
      queryParams.push(endTimestamp);
      countParams.push(endTimestamp);
    }

    // Add pagination params
    queryParams.push(limit, offset);

    // Get questions by session ID with pagination and date filtering
    const questionsQuery = {
      text: `
                SELECT 
                    id,
                    uid as qid,
                    questiontext AS question,
                    answertext AS answer,
                    uid AS user_id,
                    created_at,
                    ets,
                    channel,
                    sid AS session_id
                FROM questions
                WHERE sid = $1 
                    AND questiontext IS NOT NULL 
                    AND answertext IS NOT NULL
                    ${dateFilter}
                    AND ets <= ${Date.now()}
                ORDER BY ets DESC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `,
      values: queryParams,
    };

    // Get total count for session with date filtering
    const countQuery = {
      text: `
                SELECT COUNT(*) as total
                FROM questions
                WHERE sid = $1 
                    AND questiontext IS NOT NULL 
                    AND answertext IS NOT NULL
                    ${countDateFilter}
            `,
      values: countParams,
    };

    const [questionsResult, countResult] = await Promise.all([
      pool.query(questionsQuery),
      pool.query(countQuery),
    ]);

    const totalCount = parseInt(countResult.rows[0].total);
    const formattedData = questionsResult.rows.map(formatQuestionData);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    res.status(200).json({
      success: true,
      data: formattedData,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage: hasNextPage,
        hasPreviousPage: hasPreviousPage,
        nextPage: hasNextPage ? page + 1 : null,
        previousPage: hasPreviousPage ? page - 1 : null,
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
    console.error("Error fetching questions by session ID:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching session questions",
    });
  }
};

// Get comprehensive question statistics with date filtering
const getQuestionStats = async (req, res) => {
  try {
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
        success: false,
        error:
          "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }

    // Build date filtering
    let dateFilter = "";
    const queryParams = [];
    let paramIndex = 0;

    if (startTimestamp !== null) {
      paramIndex++;
      dateFilter += ` AND ets >= $${paramIndex}`;
      queryParams.push(startTimestamp);
    }

    if (endTimestamp !== null) {
      paramIndex++;
      dateFilter += ` AND ets <= $${paramIndex}`;
      queryParams.push(endTimestamp);
    }

    // SIMPLIFIED - Only return total questions count
    const query = {
      text: `
                SELECT COUNT(*) as total_questions
                FROM questions
                WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
            `,
      values: queryParams,
    };

    const result = await pool.query(query);
    const stats = result.rows[0];

    res.status(200).json({
      success: true,
      data: {
        totalQuestions: parseInt(stats.total_questions) || 0,
      },
      filters: {
        startDate: startDate,
        endDate: endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching question stats:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching question statistics",
    });
  }
};

// Get questions graph data for time-series visualization
const getQuestionsGraph = async (req, res) => {
  try {
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const granularity = req.query.granularity
      ? String(req.query.granularity).trim()
      : "daily";
    const search = req.query.search ? String(req.query.search).trim() : "";

    // Validate granularity parameter
    if (!["daily", "hourly", "weekly", "monthly"].includes(granularity)) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid granularity. Must be 'daily', 'hourly', 'weekly', or 'monthly'",
      });
    }

    // Validate date range
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }

    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res.status(400).json({
        success: false,
        error: "Start date cannot be after end date",
      });
    }

    // Build date filtering
    let dateFilter = "";
    const queryParams = [];
    let paramIndex = 0;

    if (startTimestamp !== null) {
      paramIndex++;
      dateFilter += ` AND ets >= $${paramIndex}`;
      queryParams.push(startTimestamp);
    }

    if (endTimestamp !== null) {
      paramIndex++;
      dateFilter += ` AND ets <= $${paramIndex}`;
      queryParams.push(endTimestamp);
    }

    // Add search filter if provided
    if (search && search.trim() !== "") {
      paramIndex++;
      dateFilter += ` AND (
                questiontext ILIKE $${paramIndex} OR 
                answertext ILIKE $${paramIndex} OR
                uid ILIKE $${paramIndex} OR
                channel ILIKE $${paramIndex}
            )`;
      queryParams.push(`%${search.trim()}%`);
    }

    // Define the date truncation and formatting based on granularity
    let dateGrouping;
    let dateFormat;
    let orderBy;

    switch (granularity) {
      case "hourly":
        dateGrouping = "DATE_TRUNC('hour', TO_TIMESTAMP(ets/1000))";
        dateFormat =
          "TO_CHAR(DATE_TRUNC('hour', TO_TIMESTAMP(ets/1000)), 'YYYY-MM-DD HH24:00')";
        orderBy = "hour_bucket";
        break;
      case "weekly":
        dateGrouping = "DATE_TRUNC('week', TO_TIMESTAMP(ets/1000))";
        dateFormat =
          "TO_CHAR(DATE_TRUNC('week', TO_TIMESTAMP(ets/1000)), 'YYYY-MM-DD')";
        orderBy = "week_bucket";
        break;
      case "monthly":
        dateGrouping = "DATE_TRUNC('month', TO_TIMESTAMP(ets/1000))";
        dateFormat =
          "TO_CHAR(DATE_TRUNC('month', TO_TIMESTAMP(ets/1000)), 'YYYY-MM')";
        orderBy = "month_bucket";
        break;
      case "daily":
      default:
        dateGrouping = "DATE_TRUNC('day', TO_TIMESTAMP(ets/1000))";
        dateFormat =
          "TO_CHAR(DATE_TRUNC('day', TO_TIMESTAMP(ets/1000)), 'YYYY-MM-DD')";
        orderBy = "day_bucket";
        break;
    }

    const query = {
      text: `
                SELECT 
                    ${dateFormat} as date,
                    ${dateGrouping} as ${orderBy},
                    COUNT(*) as questionsCount,
              
                    EXTRACT(EPOCH FROM ${dateGrouping}) * 1000 as timestamp,
                    ${granularity === "hourly"
          ? `EXTRACT(HOUR FROM ${dateGrouping}) as hour_of_day`
          : "NULL as hour_of_day"
        }
                FROM questions
                WHERE questiontext IS NOT NULL 
                    AND answertext IS NOT NULL 
                    AND ets IS NOT NULL
                    ${dateFilter}
                GROUP BY ${dateGrouping}
                ORDER BY ${orderBy} ASC
            `,
      values: queryParams,
    };

          // COUNT(DISTINCT uid) as uniqueUsersCount,
          //           COUNT(DISTINCT sid) as uniqueSessionsCount,
          //           COUNT(DISTINCT channel) as uniqueChannelsCount,
          //           AVG(LENGTH(questiontext)) as avgQuestionLength,
          //           AVG(LENGTH(answertext)) as avgAnswerLength,

    const result = await pool.query(query);

    // Format the data for frontend consumption
    const graphData = result.rows.map((row) => ({
      date: row.date,
      timestamp: parseInt(row.timestamp),
      questionsCount: parseInt(row.questionscount) || 0,
      // uniqueUsersCount: parseInt(row.uniqueuserscount) || 0,
      // uniqueSessionsCount: parseInt(row.uniquesessionscount) || 0,
      // uniqueChannelsCount: parseInt(row.uniquechannelscount) || 0,
      // avgQuestionLength: parseFloat(row.avgquestionlength) || 0,
      // avgAnswerLength: parseFloat(row.avganswerLength) || 0,
      // Add formatted values for different time periods
      ...(granularity === "hourly" && {
        hour:
          parseInt(row.hour_of_day) ||
          parseInt(row.date?.split(" ")[1]?.split(":")[0] || "0"),
      }),
      ...(granularity === "weekly" && { week: row.date }),
      ...(granularity === "monthly" && { month: row.date }),
    }));

    // Calculate summary statistics
    const totalQuestions = graphData.reduce(
      (sum, item) => sum + item.questionsCount,
      0
    );
    // const totalUniqueUsers = Math.max(
    //   ...graphData.map((item) => item.uniqueUsersCount),
    //   0
    // );
    // const avgQuestionsPerPeriod =
    //   totalQuestions / Math.max(graphData.length, 1);

    // Find peak activity period
    const peakPeriod = graphData.reduce(
      (max, item) => (item.questionsCount > max.questionsCount ? item : max),
      { questionsCount: 0, date: null }
    );

    res.status(200).json({
      success: true,
      data: graphData,
      metadata: {
        granularity: granularity,
        totalDataPoints: graphData.length,
        dateRange: {
          start: graphData.length > 0 ? graphData[0].date : null,
          end:
            graphData.length > 0 ? graphData[graphData.length - 1].date : null,
        },
        summary: {
          totalQuestions: totalQuestions,
          peakActivity: {
            date: peakPeriod.date,
            questionsCount: peakPeriod.questionsCount,
          },
        },
      },
      filters: {
        search: search,
        startDate: startDate,
        endDate: endDate,
        granularity: granularity,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching questions graph data:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

module.exports = {
  getQuestions,
  getQuestionById,
  getQuestionsByUserId,
  getQuestionsBySessionId,
  getQuestionStats,
  getQuestionsGraph,
  getTotalQuestionsCount,
  fetchQuestionsFromDB,
  formatQuestionData,
};
