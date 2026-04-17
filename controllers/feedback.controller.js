const pool = require("../services/db");
const {
  formatUTCToISTDate,
  formatDateToIST,
  parseDateRange,
} = require("../utils/dateUtils");
const { mvExists } = require("../utils/mvHealth");

// Small in-process cache for distinct channels (see getDistinctChannels).
let distinctChannelsCache = { value: null, expiresAt: 0 };
const DISTINCT_CHANNELS_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchAllFeedbackFromDB(
  page = 1,
  limit = 10,
  search = "",
  startDate = null,
  endDate = null,
  sortBy = null,
  sortOrder = "DESC",
  feedbackSource = null,
  feedbackType = null,
  channel = null,
) {
  const offset = (page - 1) * limit;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  // Base query with optional search and date filtering - using parameterized queries
  let query = `
        SELECT
            id,
            qid,
            COALESCE(fingerprint_id, uid) as user_id,
            created_at,
            feedbacktype,
            feedbacktext,
            questiontext,
            answertext,
            channel,
            sid as session_id,
            ets,
            COALESCE(feedback_source, 'chat') as feedback_source
        FROM feedback
        WHERE feedbacktext IS NOT NULL
          AND (
            (questiontext IS NOT NULL AND fingerprint_id IS NOT NULL)
            OR COALESCE(feedback_source, 'chat') = 'voice'
          )
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

  // Add search functionality if search term is provided
  if (search && search.trim() !== "") {
    paramIndex++;
    query += ` AND (
            feedbacktext ILIKE $${paramIndex} OR
            questiontext ILIKE $${paramIndex} OR
            answertext ILIKE $${paramIndex} OR
            COALESCE(fingerprint_id, uid) ILIKE $${paramIndex}
        )`;
    queryParams.push(`%${search.trim()}%`);
  }

  // Add feedback source filter (chat/voice)
  if (feedbackSource && feedbackSource !== 'all') {
    paramIndex++;
    query += ` AND COALESCE(feedback_source, 'chat') = $${paramIndex}`;
    queryParams.push(feedbackSource);
  }

  // Add feedback type filter (like/dislike)
  if (feedbackType && feedbackType !== 'all') {
    paramIndex++;
    query += ` AND feedbacktype = $${paramIndex}`;
    queryParams.push(feedbackType);
  }

  // Add channel filter
  if (channel && channel !== 'all') {
    paramIndex++;
    query += ` AND channel = $${paramIndex}`;
    queryParams.push(channel);
  }

  const sortArray = ["ets", "created_at", "user_id", "feedbacktype", "feedbacktext"];

  if (sortArray.includes(sortBy)) {
    if (sortBy === "ets") {
      query += ` ORDER BY ets ${sortOrder}, created_at ${sortOrder}`;
    } else {
      query += ` ORDER BY ${sortBy} ${sortOrder}`;
    }
  } else {
    query += ` ORDER BY ets DESC, created_at DESC`;
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

// Merged list + totals query. One filtered scan over `feedback` produces:
//  - the page rows (LIMIT/OFFSET)
//  - total row count matching the filter (COUNT(*) OVER ())
//  - total likes / dislikes for the same filter (COUNT(...) OVER ())
async function fetchAllFeedbackAndTotals({
  page = 1,
  limit = 10,
  search = "",
  startDate = null,
  endDate = null,
  sortBy = null,
  sortOrder = "DESC",
  feedbackSource = null,
  feedbackType = null,
  channel = null,
}) {
  const offset = (page - 1) * limit;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  const params = [];
  let idx = 0;
  const conditions = [
    "feedbacktext IS NOT NULL",
    "((questiontext IS NOT NULL AND fingerprint_id IS NOT NULL) OR COALESCE(feedback_source, 'chat') = 'voice')",
  ];

  if (startTimestamp !== null) {
    idx++;
    conditions.push(`ets >= $${idx}`);
    params.push(startTimestamp);
  }
  if (endTimestamp !== null) {
    idx++;
    conditions.push(`ets <= $${idx}`);
    params.push(endTimestamp);
  }
  if (search && search.trim() !== "") {
    idx++;
    conditions.push(`(
      feedbacktext ILIKE $${idx} OR
      questiontext ILIKE $${idx} OR
      answertext ILIKE $${idx} OR
      COALESCE(fingerprint_id, uid) ILIKE $${idx}
    )`);
    params.push(`%${search.trim()}%`);
  }
  if (feedbackSource && feedbackSource !== 'all') {
    idx++;
    conditions.push(`COALESCE(feedback_source, 'chat') = $${idx}`);
    params.push(feedbackSource);
  }
  if (feedbackType && feedbackType !== 'all') {
    idx++;
    conditions.push(`feedbacktype = $${idx}`);
    params.push(feedbackType);
  }
  if (channel && channel !== 'all') {
    idx++;
    conditions.push(`channel = $${idx}`);
    params.push(channel);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const sortArray = ["ets", "created_at", "user_id", "feedbacktype", "feedbacktext"];
  let orderBy;
  if (sortArray.includes(sortBy)) {
    if (sortBy === "ets") {
      orderBy = `ORDER BY ets ${sortOrder}, created_at ${sortOrder}`;
    } else {
      orderBy = `ORDER BY ${sortBy} ${sortOrder}`;
    }
  } else {
    orderBy = `ORDER BY ets DESC, created_at DESC`;
  }

  idx++;
  const limitParam = idx;
  params.push(limit);
  idx++;
  const offsetParam = idx;
  params.push(offset);

  const sql = `
    SELECT
      id,
      qid,
      COALESCE(fingerprint_id, uid) AS user_id,
      created_at,
      feedbacktype,
      feedbacktext,
      questiontext,
      answertext,
      channel,
      sid AS session_id,
      ets,
      COALESCE(feedback_source, 'chat') AS feedback_source,
      COUNT(*) OVER () AS total_count,
      COUNT(*) FILTER (WHERE feedbacktype = 'like') OVER () AS total_likes,
      COUNT(*) FILTER (WHERE feedbacktype = 'dislike') OVER () AS total_dislikes
    FROM feedback
    ${where}
    ${orderBy}
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;

  const result = await pool.query(sql, params);

  const totalCount = result.rows.length ? parseInt(result.rows[0].total_count, 10) : 0;
  const totalLikes = result.rows.length ? parseInt(result.rows[0].total_likes, 10) : 0;
  const totalDislikes = result.rows.length ? parseInt(result.rows[0].total_dislikes, 10) : 0;

  // If there are zero results for this page but we still want the totals,
  // fall back to a lightweight count-only query.
  if (result.rows.length === 0 && (startDate || endDate || search || feedbackSource || feedbackType || channel)) {
    const countSql = `
      SELECT
        COUNT(*) AS total_count,
        COUNT(*) FILTER (WHERE feedbacktype = 'like') AS total_likes,
        COUNT(*) FILTER (WHERE feedbacktype = 'dislike') AS total_dislikes
      FROM feedback
      ${where}
    `;
    const countRes = await pool.query(countSql, params.slice(0, params.length - 2));
    const row = countRes.rows[0] || { total_count: 0, total_likes: 0, total_dislikes: 0 };
    return {
      rows: [],
      totalCount: parseInt(row.total_count, 10) || 0,
      totalLikes: parseInt(row.total_likes, 10) || 0,
      totalDislikes: parseInt(row.total_dislikes, 10) || 0,
    };
  }

  return { rows: result.rows, totalCount, totalLikes, totalDislikes };
}

async function getTotalFeedbackCount(
  search = "",
  startDate = null,
  endDate = null,
  feedbackSource = null,
  feedbackType = null,
  channel = null,
) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  let query = `
        SELECT COUNT(*) as total
        FROM feedback
        WHERE feedbacktext IS NOT NULL
          AND (
            (questiontext IS NOT NULL AND fingerprint_id IS NOT NULL)
            OR COALESCE(feedback_source, 'chat') = 'voice'
          )
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
            feedbacktext ILIKE $${paramIndex} OR
            questiontext ILIKE $${paramIndex} OR
            answertext ILIKE $${paramIndex} OR
            COALESCE(fingerprint_id, uid) ILIKE $${paramIndex}
        )`;
    queryParams.push(`%${search.trim()}%`);
  }

  // Add feedback source filter
  if (feedbackSource && feedbackSource !== 'all') {
    paramIndex++;
    query += ` AND COALESCE(feedback_source, 'chat') = $${paramIndex}`;
    queryParams.push(feedbackSource);
  }

  // Add feedback type filter
  if (feedbackType && feedbackType !== 'all') {
    paramIndex++;
    query += ` AND feedbacktype = $${paramIndex}`;
    queryParams.push(feedbackType);
  }

  // Add channel filter
  if (channel && channel !== 'all') {
    paramIndex++;
    query += ` AND channel = $${paramIndex}`;
    queryParams.push(channel);
  }

  const result = await pool.query(query, queryParams);
  return parseInt(result.rows[0].total);
}

async function getTotalLikesDislikesCount(
  search = "",
  startDate = null,
  endDate = null,
  sessionId = null,
  feedbackSource = null,
  feedbackType = null,
  channel = null,
) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  let query = `
        SELECT
            SUM(CASE WHEN feedbacktype = 'like' THEN 1 ELSE 0 END) as total_likes,
            SUM(CASE WHEN feedbacktype = 'dislike' THEN 1 ELSE 0 END) as total_dislikes
        FROM feedback
        WHERE feedbacktext IS NOT NULL
          AND (
            (questiontext IS NOT NULL AND fingerprint_id IS NOT NULL)
            OR COALESCE(feedback_source, 'chat') = 'voice'
          )
    `;

  const queryParams = [];
  let paramIndex = 0;

  // Add session ID filtering if provided
  if (sessionId) {
    paramIndex++;
    query += ` AND sid = $${paramIndex}`;
    queryParams.push(sessionId);
  }

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

  // Add search filter if search term is provided
  if (search && search.trim() !== "") {
    paramIndex++;
    query += ` AND (
            feedbacktext ILIKE $${paramIndex} OR
            questiontext ILIKE $${paramIndex} OR
            answertext ILIKE $${paramIndex} OR
            COALESCE(fingerprint_id, uid) ILIKE $${paramIndex}
        )`;
    queryParams.push(`%${search.trim()}%`);
  }

  // Add feedback source filter
  if (feedbackSource && feedbackSource !== 'all') {
    paramIndex++;
    query += ` AND COALESCE(feedback_source, 'chat') = $${paramIndex}`;
    queryParams.push(feedbackSource);
  }

  // Add feedback type filter
  if (feedbackType && feedbackType !== 'all') {
    paramIndex++;
    query += ` AND feedbacktype = $${paramIndex}`;
    queryParams.push(feedbackType);
  }

  // Add channel filter
  if (channel && channel !== 'all') {
    paramIndex++;
    query += ` AND channel = $${paramIndex}`;
    queryParams.push(channel);
  }

  const result = await pool.query(query, queryParams);
  return {
    totalLikes: parseInt(result.rows[0].total_likes) || 0,
    totalDislikes: parseInt(result.rows[0].total_dislikes) || 0,
  };
}

function formatFeedbackData(feedbackItem) {
  let feedbackTime = null;
  if (feedbackItem.ets) {
    feedbackTime = formatDateToIST(feedbackItem.ets);
  } else if (feedbackItem.created_at) {
    const parsedDate = new Date(feedbackItem.created_at);
    feedbackTime = formatDateToIST(parsedDate.getTime());
  }

  return {
    qid: feedbackItem.qid,
    date: feedbackTime,
    user: feedbackItem.user_id,
    question: feedbackItem.questiontext || "",
    sessionId: feedbackItem.session_id,
    answer: feedbackItem.answertext ? feedbackItem.answertext.substring(0, 100) + "..." : "",
    rating: feedbackItem.feedbacktype,
    feedback: feedbackItem.feedbacktext,
    id: feedbackItem.id,
    timestamp: feedbackItem.ets,
    feedbackSource: feedbackItem.feedback_source || 'chat',
    channel: feedbackItem.channel || '',
  };
}

// Controller function to get all feedback with pagination, search, and date filtering
async function getAllFeedback(req, res) {
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
    const feedbackSource = req.query.feedbackSource ? String(req.query.feedbackSource).trim() : null;
    const feedbackType = req.query.feedbackType ? String(req.query.feedbackType).trim() : null;
    const channel = req.query.channel ? String(req.query.channel).trim() : null;

    // Additional validation for search term length to prevent abuse
    if (search.length > 1000) {
      return res.status(400).json({ message: "Search term too long" });
    }

    // Validate date range
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
      return res.status(400).json({
        message: "Start date cannot be after end date",
      });
    }

    // OPTIMIZED: single query with window functions replaces the original
    // three parallel scans (list + count + like/dislike totals). All three
    // aggregates are computed with COUNT(*) OVER () window functions on the
    // same filtered set.
    const { rows: rawFeedbackData, totalCount, totalLikes, totalDislikes } =
      await fetchAllFeedbackAndTotals({
        page, limit, search, startDate, endDate, sortBy, sortOrder,
        feedbackSource, feedbackType, channel,
      });

    const formattedFeedback = rawFeedbackData.map(formatFeedbackData);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Return paginated response
    res.status(200).json({
      data: formattedFeedback,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalCount,
        totalLikes: totalLikes,
        totalDislikes: totalDislikes,
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
    console.error("Error fetching feedback:", error);
    res.status(500).json({ message: "Error fetching feedback data" });
  }
}

// New function to fetch feedback by QID from the database
async function fetchFeedbackByidFromDB(id) {
  const query = {
    text: `
            SELECT
                id,
                COALESCE(fingerprint_id, uid) AS user_id,
                sid AS session_id,
                groupdetails,
                channel,
                ets,
                feedbacktext,
                questiontext,
                answertext,
                feedbacktype,
                created_at,
                qid AS question_id,
                COALESCE(feedback_source, 'chat') AS feedback_source
            FROM feedback
            WHERE id = $1
        `,
    values: [id],
  };
  const result = await pool.query(query);
  return result.rows;
}

// Controller function to get feedback by ID with proper validation
async function getFeedbackByid(req, res) {
  try {
    const { id } = req.params;

    // Validate UUID format to prevent SQL injection
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!id || !uuidRegex.test(id)) {
      return res.status(400).json({ message: "Valid UUID ID is required" });
    }

    const feedbackDetails = await fetchFeedbackByidFromDB(id);

    if (feedbackDetails.length === 0) {
      return res
        .status(404)
        .json({ message: "No feedback found for the given ID" });
    }

    res.status(200).json(feedbackDetails);
  } catch (error) {
    console.error("Error fetching feedback by ID:", error);
    res.status(500).json({ message: "Error fetching feedback data" });
  }
}

// Get feedback by session ID with date filtering
const getFeedbackBySessionId = async (req, res) => {
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
        message: "Valid Session ID is required",
      });
    }

    // Validate date range
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
      return res.status(400).json({
        message: "Start date cannot be after end date",
      });
    }

    // Build date filtering for feedback query
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

    // Get feedback by session ID with pagination and date filtering
    const feedbackQuery = {
      text: `
                SELECT
                    id,
                    qid,
                    COALESCE(fingerprint_id, uid) as user_id,
                    created_at,
                    feedbacktype,
                    feedbacktext,
                    questiontext,
                    answertext,
                    channel,
                    sid as session_id,
                    ets,
                    COALESCE(feedback_source, 'chat') as feedback_source
                FROM feedback
                WHERE sid = $1
                    AND feedbacktext IS NOT NULL
                    AND (questiontext IS NOT NULL OR COALESCE(feedback_source, 'chat') = 'voice')
                    ${dateFilter}
                ORDER BY ets DESC, created_at DESC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `,
      values: queryParams,
    };

    // Get total count for session with date filtering
    const countQuery = {
      text: `
                SELECT COUNT(*) as total
                FROM feedback
                WHERE sid = $1
                    AND feedbacktext IS NOT NULL
                    AND (questiontext IS NOT NULL OR COALESCE(feedback_source, 'chat') = 'voice')
                    ${countDateFilter}
            `,
      values: countParams,
    };

    const [feedbackResult, countResult] = await Promise.all([
      pool.query(feedbackQuery),
      pool.query(countQuery),
    ]);

    const totalCount = parseInt(countResult.rows[0].total);
    const formattedData = feedbackResult.rows.map(formatFeedbackData);

    // Get accurate total likes and dislikes counts for the entire filtered session dataset
    const { totalLikes, totalDislikes } = await getTotalLikesDislikesCount(
      "",
      startDate,
      endDate,
      sessionId.trim(),
    );

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    res.status(200).json({
      data: formattedData,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalCount,
        totalLikes: totalLikes,
        totalDislikes: totalDislikes,
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
    console.error("Error fetching feedback by session ID:", error);
    res.status(500).json({
      message: "Error fetching session feedback",
    });
  }
};

// Get comprehensive feedback statistics with date filtering
const getFeedbackStats = async (req, res) => {
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

    // MV-first: mv_feedback_daily when date range is present.
    let stats = null;
    let source = 'base';
    if (await mvExists('mv_feedback_daily') && startTimestamp !== null && endTimestamp !== null) {
      try {
        const mvRes = await pool.query(
          `SELECT
             COALESCE(SUM(total_feedback), 0) AS total_feedback,
             COALESCE(SUM(likes), 0) AS total_likes,
             COALESCE(SUM(dislikes), 0) AS total_dislikes
           FROM mv_feedback_daily
           WHERE feedback_date >= DATE(TO_TIMESTAMP($1::bigint / 1000) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
             AND feedback_date <= DATE(TO_TIMESTAMP($2::bigint / 1000) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')`,
          [startTimestamp, endTimestamp]
        );
        stats = mvRes.rows[0];
        source = 'mv';
      } catch (mvErr) {
        console.warn('[FeedbackStats] MV query failed, falling back:', mvErr.message);
      }
    }

    if (!stats) {
      const query = {
        text: `SELECT
                 COUNT(*) as total_feedback,
                 COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as total_likes,
                 COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as total_dislikes
               FROM feedback
               WHERE uid IS NOT NULL
                 AND (answertext IS NOT NULL OR COALESCE(feedback_source, 'chat') = 'voice')
                 ${dateFilter}`,
        values: queryParams,
      };
      const result = await pool.query(query);
      stats = result.rows[0];
    }

    res.status(200).json({
      success: true,
      data: {
        totalFeedback: parseInt(stats.total_feedback) || 0,
        totalLikes: parseInt(stats.total_likes) || 0,
        totalDislikes: parseInt(stats.total_dislikes) || 0,
      },
      meta: { source },
      filters: {
        startDate: startDate,
        endDate: endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching feedback stats:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching feedback statistics",
    });
  }
};

// Get feedback graph data for time-series visualization
const getFeedbackGraph = async (req, res) => {
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
                feedbacktext ILIKE $${paramIndex} OR 
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

    // MV fast-path: daily granularity without search uses mv_feedback_daily.
    let result = null;
    let source = 'base';
    if (granularity === 'daily' && !search && await mvExists('mv_feedback_daily')) {
      try {
        const mvParams = [];
        const conds = [];
        if (startTimestamp !== null) {
          mvParams.push(startTimestamp);
          conds.push(`feedback_date >= DATE(TO_TIMESTAMP($${mvParams.length}::bigint / 1000) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')`);
        }
        if (endTimestamp !== null) {
          mvParams.push(endTimestamp);
          conds.push(`feedback_date <= DATE(TO_TIMESTAMP($${mvParams.length}::bigint / 1000) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')`);
        }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const mvSql = `
          SELECT
            TO_CHAR(feedback_date, 'YYYY-MM-DD') AS date,
            feedback_date AS day_bucket,
            SUM(total_feedback) AS feedbackcount,
            SUM(likes) AS likescount,
            SUM(dislikes) AS dislikescount,
            ROUND(SUM(likes) * 100.0 / NULLIF(SUM(total_feedback), 0), 2) AS satisfactionrate,
            EXTRACT(EPOCH FROM feedback_date::timestamp) * 1000 AS timestamp,
            NULL AS hour_of_day
          FROM mv_feedback_daily
          ${where}
          GROUP BY feedback_date
          ORDER BY feedback_date ASC
        `;
        result = await pool.query(mvSql, mvParams);
        source = 'mv';
      } catch (mvErr) {
        console.warn('[FeedbackGraph] MV query failed, falling back:', mvErr.message);
        result = null;
      }
    }

    if (!result) {
      const query = {
        text: `
          SELECT
            ${dateFormat} AS date,
            ${dateGrouping} AS ${orderBy},
            COUNT(*) as feedbackCount,
            COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as likesCount,
            COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as dislikesCount,
            ROUND(COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) * 100.0 /
                                  NULLIF(COUNT(*), 0), 2) as satisfactionRate,
            EXTRACT(EPOCH FROM ${dateGrouping}) * 1000 as timestamp,
            ${granularity === 'hourly'
              ? `EXTRACT(HOUR FROM ${dateGrouping}) AS hour_of_day`
              : 'NULL AS hour_of_day'}
          FROM feedback
          WHERE feedbacktext IS NOT NULL
            AND (
              (questiontext IS NOT NULL AND fingerprint_id IS NOT NULL)
              OR COALESCE(feedback_source, 'chat') = 'voice'
            )
            AND ets IS NOT NULL
            ${dateFilter}
          GROUP BY ${dateGrouping}
          ORDER BY ${orderBy} ASC
        `,
        values: queryParams,
      };
      result = await pool.query(query);
    }

    // Format the data for frontend consumption
    const graphData = result.rows.map((row) => ({
      date: row.date,
      timestamp: parseInt(row.timestamp),
      feedbackCount: parseInt(row.feedbackcount) || 0,
      likesCount: parseInt(row.likescount) || 0,
      dislikesCount: parseInt(row.dislikescount) || 0,
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
    const totalFeedback = graphData.reduce(
      (sum, item) => sum + item.feedbackCount,
      0,
    );
    const totalLikes = graphData.reduce(
      (sum, item) => sum + item.likesCount,
      0,
    );
    const totalDislikes = graphData.reduce(
      (sum, item) => sum + item.dislikesCount,
      0,
    );

    // Find peak activity period
    const peakPeriod = graphData.reduce(
      (max, item) => (item.feedbackCount > max.feedbackCount ? item : max),
      { feedbackCount: 0, date: null },
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
          totalFeedback: totalFeedback,
          totalLikes: totalLikes,
          totalDislikes: totalDislikes,
          peakActivity: {
            date: peakPeriod.date,
            feedbackCount: peakPeriod.feedbackCount,
          },
        },
      },
      meta: { source },
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
    console.error("Error fetching feedback graph data:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// Get distinct channels for filter dropdown. Cached in-process for 5 min.
const getDistinctChannels = async (req, res) => {
  try {
    const now = Date.now();
    if (distinctChannelsCache.value && distinctChannelsCache.expiresAt > now) {
      return res.status(200).json({
        success: true,
        data: distinctChannelsCache.value,
        meta: { source: 'cache' },
      });
    }

    const result = await pool.query(
      `SELECT DISTINCT channel FROM feedback WHERE channel IS NOT NULL ORDER BY channel`
    );
    const channels = result.rows.map(r => r.channel);
    distinctChannelsCache = {
      value: channels,
      expiresAt: now + DISTINCT_CHANNELS_TTL_MS,
    };

    res.status(200).json({
      success: true,
      data: channels,
      meta: { source: 'live' },
    });
  } catch (error) {
    console.error("Error fetching distinct channels:", error);
    res.status(500).json({ success: false, error: "Error fetching channels" });
  }
};

module.exports = {
  getAllFeedback,
  getFeedbackByid,
  getFeedbackBySessionId,
  getFeedbackStats,
  getFeedbackGraph,
  getTotalFeedbackCount,
  fetchAllFeedbackFromDB,
  formatFeedbackData,
  getTotalLikesDislikesCount,
  getDistinctChannels,
};

//  SELECT
//                     ${dateFormat} as date,
//                     ${dateGrouping} as ${orderBy},
//                     COUNT(*) as feedbackCount,
//                     COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as likesCount,
//                     COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as dislikesCount,
//                     ROUND(
//                         COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) * 100.0 /
//                         NULLIF(COUNT(*), 0), 2
//                     ) as satisfactionRate,
//                     EXTRACT(EPOCH FROM ${dateGrouping}) * 1000 as timestamp,
//                     ${granularity === 'hourly' ? `EXTRACT(HOUR FROM ${dateGrouping}) as hour_of_day` : 'NULL as hour_of_day'}
//                 FROM feedback
//                 WHERE feedbacktext IS NOT NULL
//                     AND questiontext IS NOT NULL
//                     AND ets IS NOT NULL
//                     ${dateFilter}
//                 GROUP BY ${dateGrouping}
//                 ORDER BY ${orderBy} ASC
