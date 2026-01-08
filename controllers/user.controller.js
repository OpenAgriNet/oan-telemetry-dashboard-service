const pool = require('../services/db');
const { v4: uuidv4 } = require('uuid');
const { parseDateRange, formatDateToIST, getCurrentTimestamp } = require('../utils/dateUtils');

// Simple in-memory cache for user stats
const userStatsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

async function fetchUsersFromDB(page = 1, limit = 10, search = '', startDate = null, endDate = null, sortBy = null, sortOrder = 'DESC') {
    const offset = (page - 1) * limit;
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    // Create cache key for this specific query
    const cacheKey = `users_${page}_${limit}_${search}_${startTimestamp}_${endTimestamp}_${sortBy}_${sortOrder}`;
    const cachedResult = userStatsCache.get(cacheKey);

    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
        return cachedResult.data;
    }

    const queryParams = [];
    let paramIndex = 0;

    // Build WHERE conditions efficiently
    let whereConditions = ['uid IS NOT NULL', 'answertext IS NOT NULL'];

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

    // Add future ETS filter (filter out bad telemetry data with future timestamps)
    paramIndex++;
    whereConditions.push(`ets <= $${paramIndex}`);
    queryParams.push(getCurrentTimestamp());

    if (search && search.trim() !== '') {
        paramIndex++;
        whereConditions.push(`uid ILIKE $${paramIndex}`);
        queryParams.push(`%${search.trim()}%`);
    }

    const baseWhere = whereConditions.join(' AND ');

    //  WITH base_users AS (
    //         SELECT uid, ets
    //         FROM questions
    //         WHERE ${baseWhere}
    //         ORDER BY  ets DESC
    //         group BY uid,
    //         LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
    //     ),

    // Optimized query - fetch users first, then join stats
    let query = `
        WITH base_users AS (
            SELECT DISTINCT on (uid) uid, ets
            FROM questions
            WHERE ${baseWhere}
            ORDER BY uid, ets DESC
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
            ${startTimestamp ? `AND q.ets >= ${startTimestamp}` : ''}
            ${endTimestamp ? `AND q.ets <= ${endTimestamp}` : ''}
            AND q.ets <= ${getCurrentTimestamp()}
            GROUP BY bu.uid
        ),
        latest_sessions AS (
            SELECT DISTINCT ON (bu.uid)
                bu.uid as user_id,
                q.sid as session_id
            FROM base_users bu
            JOIN questions q ON q.uid = bu.uid AND q.uid IS NOT NULL AND q.answertext IS NOT NULL
            ${startTimestamp ? `AND q.ets >= ${startTimestamp}` : ''}
            ${endTimestamp ? `AND q.ets <= ${endTimestamp}` : ''}
            AND q.ets <= ${getCurrentTimestamp()}
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
            ${startTimestamp ? `AND f.ets >= ${startTimestamp}` : ''}
            ${endTimestamp ? `AND f.ets <= ${endTimestamp}` : ''}
            AND f.ets <= ${getCurrentTimestamp()}
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
    `;

       const sortArray = ["user_id", "session_count", "total_questions", "feedback_count", "last_activity", "latest_session"];
  if (sortArray.includes(sortBy)) {
    query += ` ORDER BY ${sortBy === "last_activity" ? "last_activity" : sortBy} ${sortOrder}`;
  } else {
    query += ` ORDER BY latest_session DESC`
  };
    
    query += ` LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`;
    // Add pagination parameters
    queryParams.push(limit, offset);

    try {
        const result = await pool.query(query, queryParams);

        // Cache the result
        userStatsCache.set(cacheKey, {
            data: result.rows,
            timestamp: Date.now()
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
        console.error('Error in fetchUsersFromDB:', error);
        throw error;
    }
}

async function getTotalUsersCount(search = '', startDate = null, endDate = null) {
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

    // Add future ETS filter (filter out bad telemetry data with future timestamps)
    paramIndex++;
    query += ` AND ets <= $${paramIndex}`;
    queryParams.push(getCurrentTimestamp());

    // Add search filter to count query if search term is provided
    if (search && search.trim() !== '') {
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
            timestamp: Date.now()
        });

        return totalCount;
    } catch (error) {
        console.error('Error in getTotalUsersCount:', error);
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
                latestSession = formatDateToIST(timestamp);
            } else {
                latestSession = formatDateToIST(row.latest_session);
            }
        }

        if (row.first_session) {
            const timestamp = parseInt(row.first_session);
            if (!isNaN(timestamp)) {
                firstSession = formatDateToIST(timestamp);
            } else {
                firstSession = formatDateToIST(row.first_session);
            }
        }
    } catch (err) {
        console.warn('Could not parse date:', row.latest_session || row.first_session);
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
        sessionId: row.session_id || null
    };
}

// Route handler for formatting user data endpoint
const formatUserDataHandler = async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            message: "This endpoint is for internal data formatting only",
            data: {
                description: "Use GET /users to retrieve formatted user data"
            }
        });
    } catch (error) {
        console.error("Error in format user data handler:", error);
        res.status(500).json({
            success: false,
            error: "Error in format user data handler"
        });
    }
};

// Route handler for fetching users from DB endpoint
const fetchUsersFromDBHandler = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const search = req.query.search ? String(req.query.search).trim() : '';
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

        const usersData = await fetchUsersFromDB(page, limit, search, startDate, endDate);

        res.status(200).json({
            success: true,
            data: usersData,
            filters: {
                search: search,
                startDate: startDate,
                endDate: endDate
            }
        });
    } catch (error) {
        console.error("Error in fetch users from DB handler:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching users from database"
        });
    }
};

// Route handler for getting total users count endpoint
const getTotalUsersCountHandler = async (req, res) => {
    try {
        const search = req.query.search ? String(req.query.search).trim() : '';
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

        const totalCount = await getTotalUsersCount(search, startDate, endDate);

        res.status(200).json({
            success: true,
            data: {
                totalCount: totalCount
            },
            filters: {
                search: search,
                startDate: startDate,
                endDate: endDate
            }
        });
    } catch (error) {
        console.error("Error in get total users count handler:", error);
        res.status(500).json({
            success: false,
            error: "Error getting total users count"
        });
    }
};

const getUsers = async (req, res) => {
    try {
        // Extract and sanitize pagination parameters from query string
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const search = req.query.search ? String(req.query.search).trim() : '';
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        const sortBy = req.query.sortBy;
        const sortOrder = req.query.sortOrder === 'desc' ? 'desc' : 'asc';

        // Additional validation for search term length to prevent abuse
        if (search.length > 1000) {
            return res.status(400).json({
                success: false,
                error: "Search term too long"
            });
        }

        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp"
            });
        }

        if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
            return res.status(400).json({
                success: false,
                error: "Start date cannot be after end date"
            });
        }

        // Fetch paginated users data and total count
        const [usersData, totalCount] = await Promise.all([
            fetchUsersFromDB(page, limit, search, startDate, endDate, sortBy, sortOrder),
            getTotalUsersCount(search, startDate, endDate)
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
                previousPage: hasPreviousPage ? page - 1 : null
            },
            filters: {
                search: search,
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

// Get single user details by username with date filtering
const getUserByUsername = async (req, res) => {
    try {
        const { username } = req.params;
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

        if (!username || typeof username !== 'string' || username.trim() === '') {
            return res.status(400).json({
                success: false,
                error: "Valid username is required"
            });
        }

        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp"
            });
        }

        // Build date filtering
        let dateFilter = '';
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
                error: "No user found for the given username and date range"
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
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching user by username:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching user data"
        });
    }
};

// Get user statistics and activity summary with date filtering
const getUserStats = async (req, res) => {
    try {
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp"
            });
        }

        // Build date filtering
        let dateFilter = '';
        let feedbackDateFilter = '';
        let activityDateFilter = 'WHERE created_at >= CURRENT_DATE - INTERVAL \'30 days\'';
        const queryParams = [];
        let paramIndex = 0;

        if (startTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets >= $${paramIndex}`;
            feedbackDateFilter += ` AND ets >= $${paramIndex}`;
            queryParams.push(startTimestamp);
        }

        if (endTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets <= $${paramIndex}`;
            feedbackDateFilter += ` AND ets <= $${paramIndex}`;
            queryParams.push(endTimestamp);
        }

        // If date filtering is applied, use it for activity as well
        if (startTimestamp !== null || endTimestamp !== null) {
            activityDateFilter = 'WHERE true';
            if (startTimestamp !== null) {
                activityDateFilter += ` AND ets >= $${paramIndex - 1}`;
            }
            if (endTimestamp !== null) {
                activityDateFilter += ` AND ets <= $${paramIndex}`;
            }
        }

        const query = {
            text: `
                WITH session_durations AS (
                    SELECT 
                        sid,
                        EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) as session_duration_seconds
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                    GROUP BY sid
                ),
                overall_stats AS (
                    SELECT 
                        COUNT(DISTINCT uid) as total_users,
                        COUNT(DISTINCT sid) as total_sessions,
                        COUNT(*) as total_questions
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                ),
                avg_session_duration AS (
                    SELECT 
                        AVG(session_duration_seconds) as avg_session_duration
                    FROM session_durations
                ),
                feedback_stats AS (
                    SELECT 
                        COUNT(*) as total_feedback,
                        COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as total_likes,
                        COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as total_dislikes
                    FROM feedback
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${feedbackDateFilter}
                ),
                activity_by_day AS (
                    SELECT 
                        DATE(created_at) as activity_date,
                        COUNT(DISTINCT uid) as active_users,
                        COUNT(*) as questions_count
                    FROM questions
                    ${activityDateFilter}
                        AND uid IS NOT NULL AND answertext IS NOT NULL
                    GROUP BY DATE(created_at)
                    ORDER BY activity_date DESC
                    LIMIT 30
                )
                SELECT 
                    os.*,
                    asd.avg_session_duration,
                    fs.*,
                    json_agg(
                        json_build_object(
                            'date', abd.activity_date,
                            'activeUsers', abd.active_users,
                            'questionsCount', abd.questions_count
                        ) ORDER BY abd.activity_date DESC
                    ) as daily_activity
                FROM overall_stats os
                CROSS JOIN avg_session_duration asd
                CROSS JOIN feedback_stats fs
                LEFT JOIN activity_by_day abd ON true
                GROUP BY os.total_users, os.total_sessions, os.total_questions, 
                         asd.avg_session_duration, fs.total_feedback, fs.total_likes, fs.total_dislikes
            `,
            values: queryParams
        };

        const result = await pool.query(query);
        const stats = result.rows[0];

        res.status(200).json({
            success: true,
            data: {
                totalUsers: parseInt(stats.total_users) || 0,
                totalSessions: parseInt(stats.total_sessions) || 0,
                totalQuestions: parseInt(stats.total_questions) || 0,
                totalFeedback: parseInt(stats.total_feedback) || 0,
                totalLikes: parseInt(stats.total_likes) || 0,
                totalDislikes: parseInt(stats.total_dislikes) || 0
            },
            filters: {
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching user stats:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching user statistics"
        });
    }
};

// Get comprehensive session statistics with date filtering
const getSessionStats = async (req, res) => {
    try {
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp"
            });
        }

        // Build date filtering
        let dateFilter = '';
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
            values: queryParams
        };

        const result = await pool.query(query);
        const stats = result.rows[0];

        res.status(200).json({
            success: true,
            data: {
                totalSessions: parseInt(stats.total_sessions) || 0,
                uniqueUsers: parseInt(stats.unique_users) || 0,
                totalQuestions: parseInt(stats.total_questions) || 0,
                avgQuestionsPerSession: parseFloat(stats.avg_questions_per_session) || 0,
                maxSessionDuration: parseFloat(stats.max_session_duration) || 0,
                minSessionDuration: parseFloat(stats.min_session_duration) || 0,
                channelBreakdown: stats.channel_breakdown || []
            },
            filters: {
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching session stats:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching session statistics"
        });
    }
};

// Get comprehensive question statistics with date filtering
const getQuestionStats = async (req, res) => {
    try {
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp"
            });
        }

        // Build date filtering
        let dateFilter = '';
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
            values: queryParams
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
                channelBreakdown: stats.channel_breakdown || [],
                hourlyDistribution: stats.hourly_distribution || []
            },
            filters: {
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching question stats:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching question statistics"
        });
    }
};

// Get comprehensive feedback statistics with date filtering
const getFeedbackStats = async (req, res) => {
    try {
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp"
            });
        }

        // Build date filtering
        let dateFilter = '';
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
            values: queryParams
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
                channelBreakdown: stats.channel_breakdown || [],
                topFeedbackUsers: stats.top_feedback_users || []
            },
            filters: {
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching feedback stats:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching feedback statistics"
        });
    }
};

const getUserGraph = async (req, res) => {
    try {
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        const granularity = req.query.granularity ? String(req.query.granularity).trim() : 'daily';
        const search = req.query.search ? String(req.query.search).trim() : '';

        // Validate granularity parameter
        if (!['daily', 'hourly', 'weekly', 'monthly'].includes(granularity)) {
            return res.status(400).json({
                success: false,
                error: "Invalid granularity. Must be 'daily', 'hourly', 'weekly', or 'monthly'"
            });
        }

        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp"
            });
        }

        if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
            return res.status(400).json({
                success: false,
                error: "Start date cannot be after end date"
            });
        }

        // Build date filtering
        let dateFilter = '';
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
        if (search && search.trim() !== '') {
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
            case 'hourly':
                dateGrouping = "DATE_TRUNC('hour', TO_TIMESTAMP(ets/1000) AT TIME ZONE 'Asia/Kolkata')";
                dateFormat = "TO_CHAR(DATE_TRUNC('hour', TO_TIMESTAMP(ets/1000) AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD HH24:00')";
                orderBy = "hour_bucket";
                break;
            case 'weekly':
                dateGrouping = "DATE_TRUNC('week', TO_TIMESTAMP(ets/1000) AT TIME ZONE 'Asia/Kolkata')";
                dateFormat = "TO_CHAR(DATE_TRUNC('week', TO_TIMESTAMP(ets/1000) AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')";
                orderBy = "week_bucket";
                break;
            case 'monthly':
                dateGrouping = "DATE_TRUNC('month', TO_TIMESTAMP(ets/1000) AT TIME ZONE 'Asia/Kolkata')";
                dateFormat = "TO_CHAR(DATE_TRUNC('month', TO_TIMESTAMP(ets/1000) AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM')";
                orderBy = "month_bucket";
                break;
            case 'daily':
            default:
                dateGrouping = "DATE_TRUNC('day', TO_TIMESTAMP(ets/1000) AT TIME ZONE 'Asia/Kolkata')";
                dateFormat = "TO_CHAR(DATE_TRUNC('day', TO_TIMESTAMP(ets/1000) AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')";
                orderBy = "day_bucket";
                break;
        }

        // Build date format string for the final SELECT (using da.activity_date)
        let finalDateFormat;
        switch (granularity) {
            case 'hourly':
                finalDateFormat = "TO_CHAR(da.activity_date, 'YYYY-MM-DD HH24:00')";
                break;
            case 'weekly':
            case 'monthly':
                finalDateFormat = "TO_CHAR(da.activity_date, 'YYYY-MM-DD')";
                break;
            case 'daily':
            default:
                finalDateFormat = "TO_CHAR(da.activity_date, 'YYYY-MM-DD')";
                break;
        }

        const query = {
            text: `
                WITH first_activity AS (
                    SELECT uid, MIN(DATE_TRUNC('day', TO_TIMESTAMP(ets/1000) AT TIME ZONE 'Asia/Kolkata')) as first_date
                    FROM questions 
                    WHERE uid IS NOT NULL AND ets IS NOT NULL
                    GROUP BY uid
                ),
                daily_activity AS (
                    SELECT 
                        ${dateGrouping} as activity_date,
                        uid
                    FROM questions
                    WHERE uid IS NOT NULL AND ets IS NOT NULL
                    ${dateFilter}
                    GROUP BY ${dateGrouping}, uid
                )
                SELECT 
                    ${finalDateFormat} as date,
                    da.activity_date as ${orderBy},
                    COUNT(DISTINCT da.uid) as uniqueUsersCount,
                    COUNT(DISTINCT CASE 
                        WHEN DATE_TRUNC('day', fa.first_date) = DATE_TRUNC('day', da.activity_date) 
                        THEN da.uid 
                    END) as newUsersCount,
                    COUNT(DISTINCT CASE 
                        WHEN DATE_TRUNC('day', fa.first_date) < DATE_TRUNC('day', da.activity_date) 
                        THEN da.uid 
                    END) as returningUsersCount,
                    EXTRACT(EPOCH FROM da.activity_date) * 1000 as timestamp,
                    ${granularity === 'hourly' ? `EXTRACT(HOUR FROM da.activity_date) as hour_of_day` : 'NULL as hour_of_day'}
                FROM daily_activity da
                JOIN first_activity fa ON da.uid = fa.uid
                GROUP BY da.activity_date
                ORDER BY ${orderBy} ASC 
            `,
            values: queryParams
        };

        const result = await pool.query(query);

        // Format the data for frontend consumption
        const graphData = result.rows.map(row => ({
            date: row.date,
            timestamp: parseInt(row.timestamp),
            uniqueUsersCount: parseInt(row.uniqueuserscount) || 0,
            newUsersCount: parseInt(row.newuserscount) || 0,
            returningUsersCount: parseInt(row.returninguserscount) || 0,
            // Add formatted values for different time periods
            ...(granularity === 'hourly' && {
                hour: parseInt(row.hour_of_day) || parseInt(row.date?.split(' ')[1]?.split(':')[0] || '0')
            }),
            ...(granularity === 'weekly' && { week: row.date }),
            ...(granularity === 'monthly' && { month: row.date })
        }));

        // Calculate summary statistics
        const totalUniqueUsers = Math.max(...graphData.map(item => item.uniqueUsersCount), 0);
        // Find peak activity period
        const peakPeriod = graphData.reduce((max, item) =>
            item.uniqueUsersCount > max.uniqueUsersCount ? item : max,
            { uniqueUsersCount: 0, date: null }
        );

        res.status(200).json({
            success: true,
            data: graphData,
            metadata: {
                granularity: granularity,
                totalDataPoints: graphData.length,
                dateRange: {
                    start: graphData.length > 0 ? graphData[0].date : null,
                    end: graphData.length > 0 ? graphData[graphData.length - 1].date : null
                },
                summary: {
                    totalUniqueUsers: totalUniqueUsers,
                    peakActivity: {
                        date: peakPeriod.date,
                        uniqueUsersCount: peakPeriod.uniqueUsersCount
                    }
                }
            },
            filters: {
                search: search,
                startDate: startDate,
                endDate: endDate,
                granularity: granularity,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error('Error fetching questions graph data:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
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
    getUserGraph
};