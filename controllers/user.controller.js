const pool = require("../services/db");
const { v4: uuidv4 } = require("uuid");

// Simple in-memory cache for user stats
const userStatsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Helper function to parse and validate date range parameters
function parseDateRange(startDate, endDate) {
  let startTimestamp = null;
  let endTimestamp = null;

  if (startDate) {
    if (typeof startDate === "string" && /^\d+$/.test(startDate)) {
      // Unix timestamp provided
      startTimestamp = parseInt(startDate);
    } else {
      // ISO date string provided, convert to unix timestamp (milliseconds)
      const date = new Date(startDate);
      if (!isNaN(date.getTime())) {
        startTimestamp = date.getTime();
      }
    }
  }

  if (endDate) {
    if (typeof endDate === "string" && /^\d+$/.test(endDate)) {
      // Unix timestamp provided
      endTimestamp = parseInt(endDate);
    } else {
      // ISO date string provided, convert to unix timestamp (milliseconds)
      const date = new Date(endDate);
      if (!isNaN(date.getTime())) {
        endTimestamp = date.getTime();
      }
    }
  }

  return { startTimestamp, endTimestamp };
}

async function fetchUsersFromDB(
  page = 1,
  limit = 10,
  search = "",
  startDate = null,
  endDate = null
) {
  const offset = (page - 1) * limit;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  // Create cache key for this specific query
  const cacheKey = `users_${page}_${limit}_${search}_${startTimestamp}_${endTimestamp}`;
  const cachedResult = userStatsCache.get(cacheKey);

  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
    return cachedResult.data;
  }

  const queryParams = [];
  let paramIndex = 0;

  // Build WHERE conditions efficiently
  let whereConditions = ["uid IS NOT NULL", "answertext IS NOT NULL"];

  if (startTimestamp !== null) {
    paramIndex++;
    whereConditions.push(`ets >= $${paramIndex}`);
    queryParams.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex++;
    whereConditions.push(`ets <= $${paramIndex}`);
    queryParams.push(endTimestamp);
  }

  if (search && search.trim() !== "") {
    paramIndex++;
    whereConditions.push(`uid ILIKE $${paramIndex}`);
    queryParams.push(`%${search.trim()}%`);
  }

  const baseWhere = whereConditions.join(" AND ");

  // Optimized query - fetch users first, then join stats
  const query = `
        WITH base_users AS (
            SELECT DISTINCT uid
            FROM questions
            WHERE ${baseWhere}
            ORDER BY uid
            LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
        ),
        user_questions AS (
            SELECT 
                bu.uid as user_id,
                COUNT(DISTINCT q.sid) as session_count,
                COUNT(q.id) as total_questions,
                MAX(q.ets) as latest_session,
                MIN(q.ets) as first_session,
                MAX(q.created_at) as last_activity
            FROM base_users bu
            JOIN questions q ON q.uid = bu.uid AND q.uid IS NOT NULL AND q.answertext IS NOT NULL
            ${startTimestamp ? `AND q.ets >= ${startTimestamp}` : ""}
            ${endTimestamp ? `AND q.ets <= ${endTimestamp}` : ""}
            GROUP BY bu.uid
        ),
        latest_sessions AS (
            SELECT DISTINCT ON (bu.uid)
                bu.uid as user_id,
                q.sid as session_id
            FROM base_users bu
            JOIN questions q ON q.uid = bu.uid AND q.uid IS NOT NULL AND q.answertext IS NOT NULL
            ${startTimestamp ? `AND q.ets >= ${startTimestamp}` : ""}
            ${endTimestamp ? `AND q.ets <= ${endTimestamp}` : ""}
            ORDER BY bu.uid, q.ets DESC
        ),
        user_feedback AS (
            SELECT 
                bu.uid as user_id,
                COUNT(f.id) as feedback_count,
                COUNT(CASE WHEN f.feedbacktype = 'like' THEN 1 END) as likes,
                COUNT(CASE WHEN f.feedbacktype = 'dislike' THEN 1 END) as dislikes
            FROM base_users bu
            LEFT JOIN feedback f ON f.uid = bu.uid AND f.uid IS NOT NULL AND f.answertext IS NOT NULL
            ${startTimestamp ? `AND f.ets >= ${startTimestamp}` : ""}
            ${endTimestamp ? `AND f.ets <= ${endTimestamp}` : ""}
            GROUP BY bu.uid
        )
        SELECT 
            uq.user_id,
            uq.session_count,
            uq.total_questions,
            uq.latest_session,
            uq.first_session,
            uq.last_activity,
            ls.session_id,
            COALESCE(uf.feedback_count, 0) as feedback_count,
            COALESCE(uf.likes, 0) as likes,
            COALESCE(uf.dislikes, 0) as dislikes
        FROM user_questions uq
        LEFT JOIN latest_sessions ls ON ls.user_id = uq.user_id
        LEFT JOIN user_feedback uf ON uf.user_id = uq.user_id
        ORDER BY uq.latest_session DESC NULLS LAST
    `;

  // Add pagination parameters
  queryParams.push(limit, offset);

  try {
    const result = await pool.query(query, queryParams);

    // Cache the result
    userStatsCache.set(cacheKey, {
      data: result.rows,
      timestamp: Date.now(),
    });

    // Clean up old cache entries periodically
    if (userStatsCache.size > 500) {
      const now = Date.now();
      for (const [key, value] of userStatsCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          userStatsCache.delete(key);
        }
      }
    }

    return result.rows;
  } catch (error) {
    console.error("Error in fetchUsersFromDB:", error);
    throw error;
  }
}

async function getTotalUsersCount(
  search = "",
  startDate = null,
  endDate = null
) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  // Create cache key for count query
  const cacheKey = `count_${search}_${startTimestamp}_${endTimestamp}`;
  const cachedResult = userStatsCache.get(cacheKey);

  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
    return cachedResult.data;
  }

  // Optimized count query with early filtering
  let query = `
        SELECT COUNT(DISTINCT uid) as total
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
    query += ` AND uid ILIKE $${paramIndex}`;
    queryParams.push(`%${search.trim()}%`);
  }

  try {
    const result = await pool.query(query, queryParams);
    const totalCount = parseInt(result.rows[0].total);

    // Cache the result
    userStatsCache.set(cacheKey, {
      data: totalCount,
      timestamp: Date.now(),
    });

    return totalCount;
  } catch (error) {
    console.error("Error in getTotalUsersCount:", error);
    throw error;
  }
}

function formatUserData(row) {
  let latestSession = null;
  let firstSession = null;

  try {
    if (row.latest_session) {
      const timestamp = parseInt(row.latest_session);
      if (!isNaN(timestamp)) {
        latestSession = new Date(timestamp).toISOString().slice(0, 19);
      } else {
        latestSession = new Date(row.latest_session).toISOString().slice(0, 19);
      }
    }

    if (row.first_session) {
      const timestamp = parseInt(row.first_session);
      if (!isNaN(timestamp)) {
        firstSession = new Date(timestamp).toISOString().slice(0, 19);
      } else {
        firstSession = new Date(row.first_session).toISOString().slice(0, 19);
      }
    }
  } catch (err) {
    console.warn(
      "Could not parse date:",
      row.latest_session || row.first_session
    );
  }

  return {
    id: uuidv4(), // Generate UUID for frontend compatibility
    username: row.user_id,
    sessions: parseInt(row.session_count) || 0,
    totalQuestions: parseInt(row.total_questions) || 0,
    feedbackCount: parseInt(row.feedback_count) || 0,
    likes: parseInt(row.likes) || 0,
    dislikes: parseInt(row.dislikes) || 0,
    latestSession,
    firstSession,
    lastActivity: row.last_activity,
    latestTimestamp: row.latest_session,
    firstTimestamp: row.first_session,
    sessionId: row.session_id || null,
  };
}

// Route handler for formatting user data endpoint
// Duplicate getUserGraph removed (kept earlier implementation)

// Return raw rows from DB (unformatted) for diagnostics / admin usage
const fetchUsersFromDBHandler = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    const rows = await fetchUsersFromDB(
      page,
      limit,
      search,
      startDate,
      endDate
    );
    res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
      },
      filters: { search, startDate, endDate },
    });
  } catch (error) {
    console.error("Error in fetchUsersFromDBHandler:", error);
    res.status(500).json({ success: false, error: "Error fetching users" });
  }
};

// Return formatted user objects (legacy front-end expectation) using formatUserData
const formatUserDataHandler = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    const rows = await fetchUsersFromDB(
      page,
      limit,
      search,
      startDate,
      endDate
    );
    const formatted = rows.map(formatUserData);
    res.status(200).json({
      success: true,
      data: formatted,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
      },
      filters: { search, startDate, endDate },
    });
  } catch (error) {
    console.error("Error in formatUserDataHandler:", error);
    res.status(500).json({ success: false, error: "Error formatting users" });
  }
};

// Route handler for getting total users count endpoint
const getTotalUsersCountHandler = async (req, res) => {
  try {
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    const totalCount = await getTotalUsersCount(search, startDate, endDate);

    res.status(200).json({
      success: true,
      data: {
        totalCount: totalCount,
      },
      filters: {
        search: search,
        startDate: startDate,
        endDate: endDate,
      },
    });
  } catch (error) {
    console.error("Error in get total users count handler:", error);
    res.status(500).json({
      success: false,
      error: "Error getting total users count",
    });
  }
};

const getUsers = async (req, res) => {
  try {
    // Extract and sanitize pagination parameters from query string
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

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

    // Fetch paginated users data and total count
    const [usersData, totalCount] = await Promise.all([
      fetchUsersFromDB(page, limit, search, startDate, endDate),
      getTotalUsersCount(search, startDate, endDate),
    ]);

    const formattedData = usersData.map(formatUserData);

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
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

// Get single user details by username with date filtering
const getUserByUsername = async (req, res) => {
  try {
    const { username } = req.params;
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    if (!username || typeof username !== "string" || username.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Valid username is required",
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

    // Build date filtering
    let dateFilter = "";
    const queryParams = [username.trim()];
    let paramIndex = 1;

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

    // Get comprehensive user details with date filtering
    const query = {
      text: `
                WITH user_questions AS (
                    SELECT 
                        uid,
                        COUNT(DISTINCT sid) as session_count,
                        COUNT(*) as total_questions,
                        MAX(ets) as latest_session,
                        MIN(ets) as first_session,
                        MAX(created_at) as last_activity,
                        COUNT(DISTINCT channel) as channels_used
                    FROM questions
                    WHERE uid = $1 AND answertext IS NOT NULL ${dateFilter}
                    GROUP BY uid
                ),
                user_feedback AS (
                    SELECT 
                        uid,
                        COUNT(*) as feedback_count,
                        COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as likes,
                        COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as dislikes
                    FROM feedback
                    WHERE uid = $1 AND answertext IS NOT NULL ${dateFilter}
                    GROUP BY uid
                ),
                user_channels AS (
                    SELECT 
                        uid,
                        array_agg(DISTINCT channel) FILTER (WHERE channel IS NOT NULL) as channels
                    FROM (
                        SELECT uid, channel FROM questions WHERE uid = $1 AND answertext IS NOT NULL ${dateFilter}
                        UNION
                        SELECT uid, channel FROM feedback WHERE uid = $1 AND answertext IS NOT NULL ${dateFilter}
                    ) combined
                    GROUP BY uid
                )
                SELECT 
                    uq.uid as user_id,
                    uq.session_count,
                    uq.total_questions,
                    uq.latest_session,
                    uq.first_session,
                    uq.channels_used,
                    COALESCE(uf.feedback_count, 0) as feedback_count,
                    COALESCE(uf.likes, 0) as likes,
                    COALESCE(uf.dislikes, 0) as dislikes,
                    uc.channels
                FROM user_questions uq
                LEFT JOIN user_feedback uf ON uq.uid = uf.uid
                LEFT JOIN user_channels uc ON uq.uid = uc.uid
            `,
      values: queryParams,
    };

    const result = await pool.query(query);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No user found for the given username and date range",
      });
    }

    const userData = formatUserData(result.rows[0]);
    // Add additional details for single user view
    userData.channelsUsed = result.rows[0].channels_used || 0;
    userData.channels = result.rows[0].channels || [];

    res.status(200).json({
      success: true,
      data: userData,
      filters: {
        startDate: startDate,
        endDate: endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching user by username:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching user data",
    });
  }
};

// Get user statistics and activity summary with date filtering (fixed parameter handling)
const getUserStats = async (req, res) => {
  try {
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    let { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

    if (!startDate) {
      startTimestamp = new Date("2025-05-01").getTime();
    }

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

    const cacheKey = `stats_${startTimestamp}_${endTimestamp}`;
    const cachedResult = userStatsCache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
      return res.status(200).json({
        success: true,
        data: cachedResult.data,
        filters: {
          startDate,
          endDate,
          appliedStartTimestamp: startTimestamp,
          appliedEndTimestamp: endTimestamp,
        },
      });
    }

    let questionFilter = "";
    let feedbackFilter = "";
    let errorFilter = "";
    const queryParams = [];
    let paramIndex = 0;

    if (startTimestamp !== null) {
      paramIndex++;
      questionFilter += ` AND q.ets >= $${paramIndex}`;
      feedbackFilter += ` AND f.ets >= $${paramIndex}`;
      errorFilter += ` AND e.ets >= $${paramIndex}`;
      queryParams.push(startTimestamp);
    }
    if (endTimestamp !== null) {
      paramIndex++;
      questionFilter += ` AND q.ets <= $${paramIndex}`;
      feedbackFilter += ` AND f.ets <= $${paramIndex}`;
      errorFilter += ` AND e.ets <= $${paramIndex}`;
      queryParams.push(endTimestamp);
    }

    // Always allocate start/end parameters (even if null) for cohort logic
    const startParamIndex = ++paramIndex;
    queryParams.push(startTimestamp); // may be null
    const endParamIndex = ++paramIndex;
    queryParams.push(endTimestamp); // may be null

    const query = {
      text: `
                WITH filtered_questions AS (
                    SELECT uid, sid, ets, created_at
                    FROM questions q
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${questionFilter}
                ),
                filtered_feedback AS (
                    SELECT uid, ets, feedbacktype
                    FROM feedback f
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${feedbackFilter}
                ),
                filtered_errors AS (
                    SELECT uid, sid, ets
                    FROM errordetails e
                    WHERE uid IS NOT NULL AND ets IS NOT NULL ${errorFilter}
                ),
                session_bounds AS (
                    SELECT sid, MIN(created_at) AS min_time, MAX(created_at) AS max_time
                    FROM filtered_questions
                    GROUP BY sid
                ),
                base_stats AS (
                    SELECT 
                        COUNT(DISTINCT fq.uid) AS total_users,
                        COUNT(DISTINCT fq.sid) AS total_sessions,
                        COUNT(*) AS total_questions,
                        AVG(EXTRACT(EPOCH FROM (sb.max_time - sb.min_time))) AS avg_session_duration
                    FROM filtered_questions fq
                    JOIN session_bounds sb ON fq.sid = sb.sid
                ),
                feedback_stats AS (
                    SELECT 
                        COUNT(*) AS total_feedback,
                        COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) AS total_likes,
                        COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) AS total_dislikes
                    FROM filtered_feedback
                ),
                user_firsts AS (
                    SELECT uid, MIN(ets) AS first_activity_ets
                    FROM (
                        SELECT uid, ets FROM questions WHERE uid IS NOT NULL AND ets IS NOT NULL
                        UNION ALL
                        SELECT uid, ets FROM errordetails WHERE uid IS NOT NULL AND ets IS NOT NULL
                    ) ua
                    GROUP BY uid
                ),
                user_firsts_date AS (
                    SELECT uid, (to_timestamp(first_activity_ets / 1000)::date) AS first_activity_date
                    FROM user_firsts
                ),
                  daily_activity AS (
                    SELECT 
                        day AS activity_date,
                        COUNT(DISTINCT fq.uid) AS active_users,
                        COUNT(*) AS questions_count,
                        COUNT(DISTINCT fq.sid) AS unique_sessions_count,
                        COUNT(DISTINCT CASE WHEN ufd.first_activity_date = day THEN fq.uid END) AS new_users,
                        (COUNT(DISTINCT fq.uid) - COUNT(DISTINCT CASE WHEN ufd.first_activity_date = day THEN fq.uid END)) AS returning_users,
                        (EXTRACT(EPOCH FROM (day::timestamp))::bigint * 1000) AS activity_timestamp_ms
                    FROM filtered_questions fq
                    JOIN LATERAL (VALUES (DATE(TO_TIMESTAMP(fq.ets/1000)))) AS d(day) ON true
                    LEFT JOIN user_firsts_date ufd ON ufd.uid = fq.uid
                    GROUP BY day
                    ORDER BY day DESC
                    LIMIT 30
                ),
                filtered_active_uids AS ( 
                    SELECT DISTINCT uid FROM filtered_questions
                ),
               cohort_stats AS (
    SELECT 
      COUNT(DISTINCT CASE 
                       WHEN ufd.first_activity_date BETWEEN 
                            to_timestamp($${startParamIndex}::double precision / 1000)::date 
                            AND to_timestamp($${endParamIndex}::double precision / 1000)::date
                       THEN fa.uid END) AS new_users,
      COUNT(DISTINCT CASE
                       WHEN ufd.first_activity_date < to_timestamp($${startParamIndex}::double precision / 1000)::date
                       THEN fa.uid END) AS returning_users
    FROM filtered_active_uids fa
    LEFT JOIN user_firsts_date ufd ON ufd.uid = fa.uid
),
                active_users AS (
                    SELECT COUNT(DISTINCT uid) AS active_cumulative FROM filtered_active_uids
                )
                SELECT 
                    bs.total_users,
                    bs.total_sessions,
                    bs.total_questions,
                    COALESCE(bs.avg_session_duration, 0) AS avg_session_duration,
                    COALESCE(fs.total_feedback, 0) AS total_feedback,
                    COALESCE(fs.total_likes, 0) AS total_likes,
                    COALESCE(fs.total_dislikes, 0) AS total_dislikes,
                    COALESCE(cs.new_users, 0) AS new_users,
                    COALESCE(cs.returning_users, 0) AS returning_users,
                    COALESCE(au.active_cumulative, 0) AS active_cumulative,
                    COALESCE(json_agg(json_build_object(
                        'date', da.activity_date,
                        'timestamp', da.activity_timestamp_ms,
                        'activeUsers', da.active_users,
                        'questionsCount', da.questions_count,
                        'uniqueSessionsCount', da.unique_sessions_count,
                        'newUsers', da.new_users,
                        'returningUsers', da.returning_users
                    ) ORDER BY da.activity_date DESC) FILTER (WHERE da.activity_date IS NOT NULL), '[]'::json) AS daily_activity
                FROM base_stats bs
                CROSS JOIN feedback_stats fs
                CROSS JOIN cohort_stats cs
                CROSS JOIN active_users au
                LEFT JOIN daily_activity da ON true
                GROUP BY bs.total_users, bs.total_sessions, bs.total_questions, bs.avg_session_duration,
                         fs.total_feedback, fs.total_likes, fs.total_dislikes,
                         cs.new_users, cs.returning_users, au.active_cumulative
            `,
      values: queryParams,
    };

    const result = await pool.query(query);
    const stats = result.rows[0] || {};
    const responseData = {
      totalUsers: parseInt(stats.total_users) || 0,
      totalSessions: parseInt(stats.total_sessions) || 0,
      totalQuestions: parseInt(stats.total_questions) || 0,
      totalFeedback: parseInt(stats.total_feedback) || 0,
      totalLikes: parseInt(stats.total_likes) || 0,
      totalDislikes: parseInt(stats.total_dislikes) || 0,
      avgSessionDuration: parseFloat(stats.avg_session_duration) || 0,
      dailyActivity: stats.daily_activity || [],
      newUsers: parseInt(stats.new_users) || 0,
      returningUsers: parseInt(stats.returning_users) || 0,
      activeCumulative: parseInt(stats.active_cumulative) || 0,
    };

    userStatsCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

    res.status(200).json({
      success: true,
      data: responseData,
      filters: {
        startDate,
        endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching user stats:", error);
    res
      .status(500)
      .json({ success: false, error: "Error fetching user statistics" });
  }
};

// Get comprehensive session statistics with date filtering
const getSessionStats = async (req, res) => {
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

    const query = {
      text: `
                WITH session_stats AS (
                    SELECT 
                        COUNT(DISTINCT sid) as total_sessions,
                        COUNT(DISTINCT uid) as unique_users,
                        COUNT(*) as total_questions,
                        AVG(questions_per_session) as avg_questions_per_session,
                        AVG(session_duration_seconds) as avg_session_duration,
                        MAX(session_duration_seconds) as max_session_duration,
                        MIN(session_duration_seconds) as min_session_duration
                    FROM (
                        SELECT 
                            sid,
                            uid,
                            COUNT(*) as questions_per_session,
                            EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) as session_duration_seconds
                        FROM questions
                        WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                        GROUP BY sid, uid
                    ) session_summaries
                ),
                session_activity_by_day AS (
                    SELECT 
                        DATE(created_at) as activity_date,
                        COUNT(DISTINCT sid) as sessions_count,
                        COUNT(DISTINCT uid) as unique_users_count,
                        COUNT(*) as questions_count
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                    GROUP BY DATE(created_at)
                    ORDER BY activity_date DESC
                    LIMIT 30
                ),
                channel_stats AS (
                    SELECT 
                        channel,
                        COUNT(DISTINCT sid) as sessions_count,
                        COUNT(*) as questions_count
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL AND channel IS NOT NULL ${dateFilter}
                    GROUP BY channel
                    ORDER BY sessions_count DESC
                )
                SELECT 
                    ss.*,
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'date', sabd.activity_date,
                            'sessionsCount', sabd.sessions_count,
                            'uniqueUsersCount', sabd.unique_users_count,
                            'questionsCount', sabd.questions_count
                        ) ORDER BY jsonb_build_object(
                            'date', sabd.activity_date,
                            'sessionsCount', sabd.sessions_count,
                            'uniqueUsersCount', sabd.unique_users_count,
                            'questionsCount', sabd.questions_count
                        ) -> 'date' DESC
                    ) FILTER (WHERE sabd.activity_date IS NOT NULL) as daily_activity,
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'channel', cs.channel,
                            'sessionsCount', cs.sessions_count,
                            'questionsCount', cs.questions_count
                        ) ORDER BY jsonb_build_object(
                            'channel', cs.channel,
                            'sessionsCount', cs.sessions_count,
                            'questionsCount', cs.questions_count
                        ) -> 'sessionsCount' DESC
                    ) FILTER (WHERE cs.channel IS NOT NULL) as channel_breakdown
                FROM session_stats ss
                LEFT JOIN session_activity_by_day sabd ON true
                LEFT JOIN channel_stats cs ON true
                GROUP BY ss.total_sessions, ss.unique_users, ss.total_questions, 
                         ss.avg_questions_per_session, ss.avg_session_duration, 
                         ss.max_session_duration, ss.min_session_duration
            `,
      values: queryParams,
    };

    const result = await pool.query(query);
    const stats = result.rows[0];

    res.status(200).json({
      success: true,
      data: {
        totalSessions: parseInt(stats.total_sessions) || 0,
        uniqueUsers: parseInt(stats.unique_users) || 0,
        totalQuestions: parseInt(stats.total_questions) || 0,
        avgQuestionsPerSession:
          parseFloat(stats.avg_questions_per_session) || 0,
        avgSessionDuration: parseFloat(stats.avg_session_duration) || 0,
        maxSessionDuration: parseFloat(stats.max_session_duration) || 0,
        minSessionDuration: parseFloat(stats.min_session_duration) || 0,
        dailyActivity: stats.daily_activity || [],
        channelBreakdown: stats.channel_breakdown || [],
      },
      filters: {
        startDate: startDate,
        endDate: endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching session stats:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching session statistics",
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

    const query = {
      text: `
                WITH question_stats AS (
                    SELECT 
                        COUNT(*) as total_questions,
                        COUNT(DISTINCT uid) as unique_users,
                        COUNT(DISTINCT sid) as unique_sessions,
                        COUNT(DISTINCT channel) as unique_channels,
                        AVG(LENGTH(questiontext)) as avg_question_length,
                        AVG(LENGTH(answertext)) as avg_answer_length
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                ),
                question_activity_by_day AS (
                    SELECT 
                        DATE(created_at) as activity_date,
                        COUNT(*) as questions_count,
                        COUNT(DISTINCT uid) as unique_users_count,
                        COUNT(DISTINCT sid) as unique_sessions_count,
                        AVG(LENGTH(questiontext)) as avg_question_length,
                        AVG(LENGTH(answertext)) as avg_answer_length
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                    GROUP BY DATE(created_at)
                    ORDER BY activity_date DESC
                    LIMIT 30
                ),
                question_channel_stats AS (
                    SELECT 
                        channel,
                        COUNT(*) as questions_count,
                        COUNT(DISTINCT uid) as unique_users,
                        COUNT(DISTINCT sid) as unique_sessions,
                        AVG(LENGTH(questiontext)) as avg_question_length
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL AND channel IS NOT NULL ${dateFilter}
                    GROUP BY channel
                    ORDER BY questions_count DESC
                ),
                hourly_distribution AS (
                    SELECT 
                        EXTRACT(HOUR FROM created_at) as hour_of_day,
                        COUNT(*) as questions_count
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                    GROUP BY EXTRACT(HOUR FROM created_at)
                    ORDER BY hour_of_day
                )
                SELECT 
                    qs.*,
                    json_agg(
                        jsonb_build_object(
                            'date', qabd.activity_date,
                            'questionsCount', qabd.questions_count,
                            'uniqueUsersCount', qabd.unique_users_count,
                            'uniqueSessionsCount', qabd.unique_sessions_count,
                            'avgQuestionLength', qabd.avg_question_length,
                            'avgAnswerLength', qabd.avg_answer_length
                        ) ORDER BY qabd.activity_date DESC
                    ) FILTER (WHERE qabd.activity_date IS NOT NULL) as daily_activity,
                    json_agg(
                        jsonb_build_object(
                            'channel', qcs.channel,
                            'questionsCount', qcs.questions_count,
                            'uniqueUsers', qcs.unique_users,
                            'uniqueSessions', qcs.unique_sessions,
                            'avgQuestionLength', qcs.avg_question_length
                        ) ORDER BY qcs.questions_count DESC
                    ) FILTER (WHERE qcs.channel IS NOT NULL) as channel_breakdown,
                    json_agg(
                        jsonb_build_object(
                            'hour', hd.hour_of_day,
                            'questionsCount', hd.questions_count
                        ) ORDER BY hd.hour_of_day
                    ) FILTER (WHERE hd.hour_of_day IS NOT NULL) as hourly_distribution
                FROM question_stats qs
                LEFT JOIN question_activity_by_day qabd ON true
                LEFT JOIN question_channel_stats qcs ON true
                LEFT JOIN hourly_distribution hd ON true
                GROUP BY qs.total_questions, qs.unique_users, qs.unique_sessions, 
                         qs.unique_channels, qs.avg_question_length, qs.avg_answer_length
            `,
      values: queryParams,
    };

    const result = await pool.query(query);
    const stats = result.rows[0];

    res.status(200).json({
      success: true,
      data: {
        totalQuestions: parseInt(stats.total_questions) || 0,
        uniqueUsers: parseInt(stats.unique_users) || 0,
        uniqueSessions: parseInt(stats.unique_sessions) || 0,
        uniqueChannels: parseInt(stats.unique_channels) || 0,
        avgQuestionLength: parseFloat(stats.avg_question_length) || 0,
        avgAnswerLength: parseFloat(stats.avg_answer_length) || 0,
        dailyActivity: stats.daily_activity || [],
        channelBreakdown: stats.channel_breakdown || [],
        hourlyDistribution: stats.hourly_distribution || [],
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

    const query = {
      text: `
                WITH feedback_stats AS (
                    SELECT 
                        COUNT(*) as total_feedback,
                        COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as total_likes,
                        COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as total_dislikes,
                        COUNT(DISTINCT uid) as unique_users,
                        COUNT(DISTINCT sid) as unique_sessions,
                        ROUND(
                            COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) * 100.0 / 
                            NULLIF(COUNT(*), 0), 2
                        ) as satisfaction_rate,
                        AVG(LENGTH(feedbacktext)) as avg_feedback_length
                    FROM feedback
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                ),
                feedback_activity_by_day AS (
                    SELECT 
                        DATE(created_at) as activity_date,
                        COUNT(*) as feedback_count,
                        COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as likes_count,
                        COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as dislikes_count,
                        COUNT(DISTINCT uid) as unique_users_count,
                        ROUND(
                            COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) * 100.0 / 
                            NULLIF(COUNT(*), 0), 2
                        ) as daily_satisfaction_rate
                    FROM feedback
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                    GROUP BY DATE(created_at)
                    ORDER BY activity_date DESC
                    LIMIT 30
                ),
                feedback_channel_stats AS (
                    SELECT 
                        channel,
                        COUNT(*) as feedback_count,
                        COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as likes_count,
                        COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as dislikes_count,
                        COUNT(DISTINCT uid) as unique_users,
                        ROUND(
                            COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) * 100.0 / 
                            NULLIF(COUNT(*), 0), 2
                        ) as channel_satisfaction_rate
                    FROM feedback
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL AND channel IS NOT NULL ${dateFilter}
                    GROUP BY channel
                    ORDER BY feedback_count DESC
                ),
                top_feedback_users AS (
                    SELECT 
                        uid,
                        COUNT(*) as feedback_count,
                        COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as likes_count,
                        COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as dislikes_count
                    FROM feedback
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                    GROUP BY uid
                    ORDER BY feedback_count DESC
                    LIMIT 10
                )
                SELECT 
                    fs.*,
                    json_agg(
                        jsonb_build_object(
                            'date', fabd.activity_date,
                            'feedbackCount', fabd.feedback_count,
                            'likesCount', fabd.likes_count,
                            'dislikesCount', fabd.dislikes_count,
                            'uniqueUsersCount', fabd.unique_users_count,
                            'satisfactionRate', fabd.daily_satisfaction_rate
                        ) ORDER BY fabd.activity_date DESC
                    ) FILTER (WHERE fabd.activity_date IS NOT NULL) as daily_activity,
                    json_agg(
                        jsonb_build_object(
                            'channel', fcs.channel,
                            'feedbackCount', fcs.feedback_count,
                            'likesCount', fcs.likes_count,
                            'dislikesCount', fcs.dislikes_count,
                            'uniqueUsers', fcs.unique_users,
                            'satisfactionRate', fcs.channel_satisfaction_rate
                        ) ORDER BY fcs.feedback_count DESC
                    ) FILTER (WHERE fcs.channel IS NOT NULL) as channel_breakdown,
                    json_agg(
                        jsonb_build_object(
                            'userId', tfu.uid,
                            'feedbackCount', tfu.feedback_count,
                            'likesCount', tfu.likes_count,
                            'dislikesCount', tfu.dislikes_count
                        ) ORDER BY tfu.feedback_count DESC
                    ) FILTER (WHERE tfu.uid IS NOT NULL) as top_feedback_users
                FROM feedback_stats fs
                LEFT JOIN feedback_activity_by_day fabd ON true
                LEFT JOIN feedback_channel_stats fcs ON true
                LEFT JOIN top_feedback_users tfu ON true
                GROUP BY fs.total_feedback, fs.total_likes, fs.total_dislikes, 
                         fs.unique_users, fs.unique_sessions, fs.satisfaction_rate, fs.avg_feedback_length
            `,
      values: queryParams,
    };

    const result = await pool.query(query);
    const stats = result.rows[0];

    res.status(200).json({
      success: true,
      data: {
        totalFeedback: parseInt(stats.total_feedback) || 0,
        totalLikes: parseInt(stats.total_likes) || 0,
        totalDislikes: parseInt(stats.total_dislikes) || 0,
        uniqueUsers: parseInt(stats.unique_users) || 0,
        uniqueSessions: parseInt(stats.unique_sessions) || 0,
        satisfactionRate: parseFloat(stats.satisfaction_rate) || 0,
        avgFeedbackLength: parseFloat(stats.avg_feedback_length) || 0,
        dailyActivity: stats.daily_activity || [],
        channelBreakdown: stats.channel_breakdown || [],
        topFeedbackUsers: stats.top_feedback_users || [],
      },
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

const getUserGraph = async (req, res) => {
  try {
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const granularity = req.query.granularity
      ? String(req.query.granularity).trim()
      : "daily";
    const search = req.query.search ? String(req.query.search).trim() : "";

    if (!["daily", "hourly", "weekly", "monthly"].includes(granularity)) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid granularity. Must be 'daily', 'hourly', 'weekly', or 'monthly'",
      });
    }

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
      return res
        .status(400)
        .json({ success: false, error: "Start date cannot be after end date" });
    }

    // Build date filtering for main graph query (we'll inject this into inner subquery where `ets` exists)
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

    // date grouping template
    let dateGrouping, dateFormat, orderBy, truncUnit;
    switch (granularity) {
      case "hourly":
        truncUnit = "hour";
        dateGrouping = "DATE_TRUNC('hour', TO_TIMESTAMP(ets/1000))";
        dateFormat =
          "TO_CHAR(DATE_TRUNC('hour', TO_TIMESTAMP(ets/1000)), 'YYYY-MM-DD HH24:00')";
        orderBy = "hour_bucket";
        break;
      case "weekly":
        truncUnit = "week";
        dateGrouping = "DATE_TRUNC('week', TO_TIMESTAMP(ets/1000))";
        dateFormat =
          "TO_CHAR(DATE_TRUNC('week', TO_TIMESTAMP(ets/1000)), 'YYYY-MM-DD')";
        orderBy = "week_bucket";
        break;
      case "monthly":
        truncUnit = "month";
        dateGrouping = "DATE_TRUNC('month', TO_TIMESTAMP(ets/1000))";
        dateFormat =
          "TO_CHAR(DATE_TRUNC('month', TO_TIMESTAMP(ets/1000)), 'YYYY-MM')";
        orderBy = "month_bucket";
        break;
      case "daily":
      default:
        truncUnit = "day";
        dateGrouping = "DATE_TRUNC('day', TO_TIMESTAMP(ets/1000))";
        dateFormat =
          "TO_CHAR(DATE_TRUNC('day', TO_TIMESTAMP(ets/1000)), 'YYYY-MM-DD')";
        orderBy = "day_bucket";
        break;
    }

    // Graph SQL — note: dateFilter injected inside inner SELECT so 'ets' is available there.
    // Also: compare using the alias (tpa.${orderBy}) in user_categorization instead of the raw ${dateGrouping}.
    const graphSql = {
      text: `
        WITH user_first_activity AS (
          SELECT uid, MIN(ets) AS first_activity_timestamp
          FROM (
            SELECT uid, ets FROM questions WHERE uid IS NOT NULL AND ets IS NOT NULL
            UNION ALL
            SELECT uid, ets FROM errordetails WHERE uid IS NOT NULL AND ets IS NOT NULL
          ) AS all_activity
          GROUP BY uid
        ),
        time_period_activity AS (
          SELECT
            ${dateFormat} AS date,
            ${dateGrouping} AS ${orderBy},
            uid,
            sid,
            ets,
            EXTRACT(EPOCH FROM ${dateGrouping}) * 1000 AS timestamp
          FROM (
            SELECT uid, sid, ets
            FROM questions
            WHERE uid IS NOT NULL AND ets IS NOT NULL AND answertext IS NOT NULL
            ${dateFilter}
          ) AS combined
        ),
        user_categorization AS (
          SELECT
            tpa.date,
            tpa.${orderBy} AS ${orderBy},
            tpa.timestamp,
            tpa.uid,
            tpa.sid,
            ufa.first_activity_timestamp,
            -- compare using the bucket alias (tpa.${orderBy}) to determine new vs returning
            CASE WHEN tpa.${orderBy} = DATE_TRUNC('${truncUnit}', TO_TIMESTAMP(ufa.first_activity_timestamp::double precision/1000))
              THEN 'new' ELSE 'returning' END AS user_type
          FROM time_period_activity tpa
          JOIN user_first_activity ufa ON tpa.uid = ufa.uid
        )
        SELECT date, ${orderBy}, timestamp,
               COUNT(DISTINCT CASE WHEN user_type = 'new' THEN uid END) AS newUsers,
               COUNT(DISTINCT CASE WHEN user_type = 'returning' THEN uid END) AS returningUsers,
               COUNT(DISTINCT sid) AS uniqueSessionsCount,
               ${
                 granularity === "hourly"
                   ? `EXTRACT(HOUR FROM ${orderBy}) as hour_of_day`
                   : "NULL as hour_of_day"
               }
        FROM user_categorization
        GROUP BY date, ${orderBy}, timestamp
        ORDER BY ${orderBy} ASC
      `,
      values: queryParams,
    };

    const graphResult = await pool.query(graphSql);
    const graphRows = graphResult.rows;

    // Format bucketed data
    const graphData = graphRows.map((row) => ({
      date: row.date,
      timestamp: parseInt(row.timestamp),
      newUsers: parseInt(row.newusers) || 0,
      returningUsers: parseInt(row.returningusers) || 0,
      uniqueSessionsCount: parseInt(row.uniquesessionscount) || 0,
      ...(granularity === "hourly" && {
        hour:
          parseInt(row.hour_of_day) ||
          parseInt(row.date?.split(" ")[1]?.split(":")[0] || "0"),
      }),
      ...(granularity === "weekly" && { week: row.date }),
      ...(granularity === "monthly" && { month: row.date }),
    }));

    // Cohort totals (distinct users) — same logic as getUserStats
    let cohortNew = 0;
    let cohortReturning = 0;
    if (startTimestamp !== null && endTimestamp !== null) {
      const cohortSql = `
        WITH user_firsts AS (
          SELECT uid, MIN(ets) AS first_activity_ets
          FROM (
            SELECT uid, ets FROM questions WHERE uid IS NOT NULL AND ets IS NOT NULL
            UNION ALL
            SELECT uid, ets FROM errordetails WHERE uid IS NOT NULL AND ets IS NOT NULL
          ) ua
          GROUP BY uid
        ),
        active_uids AS (
          SELECT DISTINCT uid
          FROM questions
          WHERE uid IS NOT NULL AND answertext IS NOT NULL
            AND ets >= $1::bigint
            AND ets <= $2::bigint
        )
        SELECT
          COUNT(DISTINCT CASE WHEN to_timestamp(first_activity_ets::double precision/1000)::date
                 BETWEEN to_timestamp($1::double precision/1000)::date AND to_timestamp($2::double precision/1000)::date
            THEN au.uid END) AS new_users,
          COUNT(DISTINCT CASE WHEN to_timestamp(first_activity_ets::double precision/1000)::date
                 < to_timestamp($1::double precision/1000)::date
            THEN au.uid END) AS returning_users
        FROM active_uids au
        LEFT JOIN user_firsts uf ON uf.uid = au.uid;
      `;
      const cohortRes = await pool.query(cohortSql, [
        startTimestamp,
        endTimestamp,
      ]);
      cohortNew = parseInt(cohortRes.rows[0].new_users) || 0;
      cohortReturning = parseInt(cohortRes.rows[0].returning_users) || 0;
    } else {
      cohortNew = graphData.reduce((s, it) => s + it.newUsers, 0);
      cohortReturning = graphData.reduce((s, it) => s + it.returningUsers, 0);
    }

    // Peaks
    const peakNewUsersPeriod = graphData.reduce(
      (max, item) => (item.newUsers > max.newUsers ? item : max),
      { newUsers: 0, date: null }
    );
    const peakReturningUsersPeriod = graphData.reduce(
      (max, item) => (item.returningUsers > max.returningUsers ? item : max),
      { returningUsers: 0, date: null }
    );

    res.status(200).json({
      success: true,
      data: graphData,
      metadata: {
        granularity,
        totalDataPoints: graphData.length,
        dateRange: {
          start: graphData.length > 0 ? graphData[0].date : null,
          end:
            graphData.length > 0 ? graphData[graphData.length - 1].date : null,
        },
        summary: {
          totalNewUsers: cohortNew,
          totalReturningUsers: cohortReturning,
          peakNewUsersActivity: {
            date: peakNewUsersPeriod.date,
            newUsers: peakNewUsersPeriod.newUsers,
          },
          peakReturningUsersActivity: {
            date: peakReturningUsersPeriod.date,
            returningUsers: peakReturningUsersPeriod.returningUsers,
          },
        },
      },
      filters: {
        search,
        startDate,
        endDate,
        granularity,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching questions graph data:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

module.exports = {
  getUsers,
  getUserByUsername,
  getUserStats,
  getSessionStats,
  getQuestionStats,
  getFeedbackStats,
  getTotalUsersCount,
  fetchUsersFromDB,
  formatUserData,
  formatUserDataHandler,
  fetchUsersFromDBHandler,
  getTotalUsersCountHandler,
  getUserGraph,
  // Test utility (sanity tests): clear in-memory cache
  __clearUserStatsCache: () => userStatsCache.clear(),
};
