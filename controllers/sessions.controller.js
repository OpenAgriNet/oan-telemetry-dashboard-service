const pool = require('../services/db');

// Helper function to parse and validate date range parameters
function parseDateRange(startDate, endDate) {
    let startTimestamp = null;
    let endTimestamp = null;
    
    if (startDate) {
        if (typeof startDate === 'string' && /^\d+$/.test(startDate)) {
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
        if (typeof endDate === 'string' && /^\d+$/.test(endDate)) {
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

async function fetchSessionsFromDB(page = 1, limit = 10, search = '', startDate = null, endDate = null) {
    const offset = (page - 1) * limit;
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
    // Build the WHERE conditions for date filtering
    let dateConditions = '';
    const queryParams = [];
    let paramIndex = 0;
    
    if (startTimestamp !== null) {
        paramIndex++;
        dateConditions += ` AND ets >= $${paramIndex}`;
        queryParams.push(startTimestamp);
    }
    
    if (endTimestamp !== null) {
        paramIndex++;
        dateConditions += ` AND ets <= $${paramIndex}`;
        queryParams.push(endTimestamp);
    }
    
    // Base CTE query with date filtering applied to all tables
    let query = `
        WITH combined_sessions AS (
            SELECT 
                sid,
                uid,
                questiontext,
                ets
            FROM questions
            WHERE sid IS NOT NULL AND answertext IS NOT NULL${dateConditions}
            UNION ALL
            SELECT 
                sid,
                uid,
                NULL as questiontext,
                ets
            FROM feedback
            WHERE sid IS NOT NULL${dateConditions}
            UNION ALL
            SELECT 
                sid,
                uid,
                NULL as questiontext,
                ets
            FROM errordetails
            WHERE sid IS NOT NULL${dateConditions}
        )
        SELECT 
            sid as session_id,
            uid as username,
            COUNT(questiontext) as question_count,
            MAX(ets) as session_time
        FROM combined_sessions
        GROUP BY sid, uid
    `;
    
    // Add search functionality if search term is provided
    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` HAVING (
            sid ILIKE $${paramIndex} OR 
            uid ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${search.trim()}%`);
    }
    
    query += ` ORDER BY session_time DESC`;
    
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

async function getTotalSessionsCount(search = '', startDate = null, endDate = null) {
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
    // Build the WHERE conditions for date filtering
    let dateConditions = '';
    const queryParams = [];
    let paramIndex = 0;
    
    if (startTimestamp !== null) {
        paramIndex++;
        dateConditions += ` AND ets >= $${paramIndex}`;
        queryParams.push(startTimestamp);
    }
    
    if (endTimestamp !== null) {
        paramIndex++;
        dateConditions += ` AND ets <= $${paramIndex}`;
        queryParams.push(endTimestamp);
    }
    
    let query = `
        WITH combined_sessions AS (
            SELECT 
                sid,
                uid,
                questiontext,
                ets
            FROM questions
            WHERE sid IS NOT NULL AND answertext IS NOT NULL${dateConditions}
            UNION ALL
            SELECT 
                sid,
                uid,
                NULL as questiontext,
                ets
            FROM feedback
            WHERE sid IS NOT NULL${dateConditions}
            UNION ALL
            SELECT 
                sid,
                uid,
                NULL as questiontext,
                ets
            FROM errordetails
            WHERE sid IS NOT NULL${dateConditions}
        ),
        session_groups AS (
            SELECT 
                sid,
                uid,
                COUNT(questiontext) as question_count,
                MAX(ets) as session_time
            FROM combined_sessions
            GROUP BY sid, uid
        )
        SELECT COUNT(*) as total
        FROM session_groups
    `;
    
    // Add search filter to count query if search term is provided
    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` WHERE (
            sid ILIKE $${paramIndex} OR 
            uid ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${search.trim()}%`);
    }
    
    const result = await pool.query(query, queryParams);
    return parseInt(result.rows[0].total);
}

function formatSessionData(row) {
    let sessionTime = null;
    
    try {
        if (row.session_time) {
            // First try to parse the timestamp if it's in milliseconds
            const timestamp = parseInt(row.session_time);
            if (!isNaN(timestamp)) {
                sessionTime = new Date(timestamp).toISOString().slice(0, 19);
            } else {
                // If not a timestamp, try parsing as a date string
                sessionTime = new Date(row.session_time).toISOString().slice(0, 19);
            }
        }
    } catch (err) {
        console.warn('Could not parse date:', row.session_time);
        sessionTime = null;
    }

    return {
        sessionId: row.session_id,
        username: row.username,
        questionCount: parseInt(row.question_count) || 0,
        sessionTime,
        timestamp: row.session_time
    };
}

const getSessions = async (req, res) => {
    try {
        console.log('Fetching sessions...');
        
        // Extract and sanitize pagination parameters from query string
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const search = req.query.search ? String(req.query.search).trim() : '';
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        
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

        // Fetch paginated sessions data and total count
        const [sessionsData, totalCount] = await Promise.all([
            fetchSessionsFromDB(page, limit, search, startDate, endDate),
            getTotalSessionsCount(search, startDate, endDate)
        ]);

        console.log('Query result:', sessionsData.length, 'sessions found for page', page);

        const formattedData = sessionsData.map(formatSessionData);
        
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
        console.error('Error fetching sessions:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

// Get single session details by session ID with date filtering
const getSessionById = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return res.status(400).json({ 
                success: false,
                error: "Valid Session ID is required" 
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
        
        // Build date filtering conditions
        let dateConditions = '';
        const queryParams = [sessionId.trim()];
        let paramIndex = 1;
        
        if (startTimestamp !== null) {
            paramIndex++;
            dateConditions += ` AND ets >= $${paramIndex}`;
            queryParams.push(startTimestamp);
        }
        
        if (endTimestamp !== null) {
            paramIndex++;
            dateConditions += ` AND ets <= $${paramIndex}`;
            queryParams.push(endTimestamp);
        }
        
        // Get session details with all related data and date filtering
        const query = {
            text: `
                WITH session_questions AS (
                    SELECT 
                        id,
                        uid,
                        sid,
                        questiontext,
                        answertext,
                        ets,
                        created_at,
                        channel,
                        'question' as type
                    FROM questions
                    WHERE sid = $1 AND answertext IS NOT NULL${dateConditions}
                ),
                session_feedback AS (
                    SELECT 
                        id,
                        uid,
                        sid,
                        feedbacktext as content,
                        feedbacktype,
                        ets,
                        created_at,
                        channel,
                        'feedback' as type
                    FROM feedback
                    WHERE sid = $1 AND answertext IS NOT NULL${dateConditions}
                ),
                session_errors AS (
                    SELECT 
                        id,
                        uid,
                        sid,
                        NULL as content,
                        NULL as feedbacktype,
                        ets,
                        created_at,
                        NULL as channel,
                        'error' as type
                    FROM errordetails
                    WHERE sid = $1${dateConditions}
                )
                SELECT * FROM session_questions
                UNION ALL
                SELECT 
                    id, uid, sid, content, feedbacktype, ets, created_at, channel, type
                FROM session_feedback
                UNION ALL
                SELECT 
                    id, uid, sid, content, feedbacktype, ets, created_at, channel, type
                FROM session_errors
                ORDER BY ets DESC, created_at DESC
            `,
            values: queryParams,
        };
        
        const result = await pool.query(query);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: "No session found for the given ID and date range" 
            });
        }
        
        // Group data by type and format
        const sessionData = {
            sessionId: sessionId.trim(),
            username: result.rows[0].uid,
            questions: [],
            feedback: [],
            errors: [],
            totalItems: result.rows.length
        };
        
        result.rows.forEach(row => {
            const formattedRow = {
                id: row.id,
                timestamp: row.ets,
                createdAt: row.created_at,
                channel: row.channel
            };
            
            if (row.type === 'question') {
                sessionData.questions.push({
                    ...formattedRow,
                    questionText: row.questiontext,
                    answerText: row.answertext
                });
            } else if (row.type === 'feedback') {
                sessionData.feedback.push({
                    ...formattedRow,
                    feedbackText: row.content,
                    feedbackType: row.feedbacktype
                });
            } else if (row.type === 'error') {
                sessionData.errors.push(formattedRow);
            }
        });
        
        res.status(200).json({
            success: true,
            data: sessionData,
            filters: {
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching session by ID:", error);
        res.status(500).json({ 
            success: false,
            error: "Error fetching session data" 
        });
    }
};

// Get sessions by user ID with date filtering
const getSessionsByUserId = async (req, res) => {
    try {
        const { userId } = req.params;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        const offset = (page - 1) * limit;
        
        if (!userId || typeof userId !== 'string' || userId.trim() === '') {
            return res.status(400).json({ 
                success: false,
                error: "Valid User ID is required" 
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
        
        // Build date filtering conditions
        let dateConditions = '';
        const queryParams = [userId.trim()];
        const countParams = [userId.trim()];
        let paramIndex = 1;
        
        if (startTimestamp !== null) {
            paramIndex++;
            dateConditions += ` AND ets >= $${paramIndex}`;
            queryParams.push(startTimestamp);
            countParams.push(startTimestamp);
        }
        
        if (endTimestamp !== null) {
            paramIndex++;
            dateConditions += ` AND ets <= $${paramIndex}`;
            queryParams.push(endTimestamp);
            countParams.push(endTimestamp);
        }
        
        // Add pagination params
        queryParams.push(limit, offset);
        
        // Get sessions by user ID with pagination and date filtering
        const sessionsQuery = {
            text: `
                WITH combined_sessions AS (
                    SELECT 
                        sid,
                        uid,
                        questiontext,
                        ets
                    FROM questions
                    WHERE sid IS NOT NULL AND uid = $1 AND answertext IS NOT NULL${dateConditions}
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM feedback
                    WHERE sid IS NOT NULL AND uid = $1${dateConditions}
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM errordetails
                    WHERE sid IS NOT NULL AND uid = $1${dateConditions}
                )
                SELECT 
                    sid as session_id,
                    uid as username,
                    COUNT(questiontext) as question_count,
                    MAX(ets) as session_time
                FROM combined_sessions
                GROUP BY sid, uid
                ORDER BY session_time DESC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `,
            values: queryParams,
        };
        
        // Get total count for user with date filtering
        const countQuery = {
            text: `
                WITH combined_sessions AS (
                    SELECT 
                        sid,
                        uid,
                        questiontext,
                        ets
                    FROM questions
                    WHERE sid IS NOT NULL AND uid = $1 AND answertext IS NOT NULL${dateConditions}
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM feedback
                    WHERE sid IS NOT NULL AND uid = $1${dateConditions}
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM errordetails
                    WHERE sid IS NOT NULL AND uid = $1${dateConditions}
                )
                SELECT COUNT(DISTINCT sid) as total
                FROM combined_sessions
            `,
            values: countParams,
        };
        
        const [sessionsResult, countResult] = await Promise.all([
            pool.query(sessionsQuery),
            pool.query(countQuery)
        ]);
        
        const totalCount = parseInt(countResult.rows[0].total);
        const formattedData = sessionsResult.rows.map(formatSessionData);
        
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
                previousPage: hasPreviousPage ? page - 1 : null
            },
            filters: {
                userId: userId.trim(),
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching sessions by user ID:", error);
        res.status(500).json({ 
            success: false,
            error: "Error fetching user sessions" 
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
                    -- Use consistent session counting logic that matches /sessions endpoint
                    SELECT 
                        COUNT(DISTINCT session_user_pair) as total_sessions,
                        COUNT(DISTINCT uid) as unique_users,
                        COUNT(*) as total_questions,
                        AVG(questions_per_session) as avg_questions_per_session,
                        AVG(session_duration_seconds) as avg_session_duration,
                        MAX(session_duration_seconds) as max_session_duration,
                        MIN(session_duration_seconds) as min_session_duration
                    FROM (
                        SELECT 
                            CONCAT(sid, '_', uid) as session_user_pair,
                            sid,
                            uid,
                            COUNT(*) as questions_per_session,
                            EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) as session_duration_seconds
                        FROM questions
                        WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                        GROUP BY sid, uid
                    ) session_summaries
                ),
                consistent_session_count AS (
                    -- Get total sessions including those with only feedback or errors
                    SELECT COUNT(DISTINCT session_user_pair) as total_sessions_all_activity
                    FROM (
                        SELECT CONCAT(sid, '_', uid) as session_user_pair
                        FROM questions
                        WHERE sid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                        UNION
                        SELECT CONCAT(sid, '_', uid) as session_user_pair
                        FROM feedback
                        WHERE sid IS NOT NULL ${dateFilter}
                        UNION
                        SELECT CONCAT(sid, '_', uid) as session_user_pair
                        FROM errordetails
                        WHERE sid IS NOT NULL ${dateFilter}
                    ) combined_sessions
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
                    csc.total_sessions_all_activity as total_sessions,
                    json_agg(
                        jsonb_build_object(
                            'date', sabd.activity_date,
                            'sessionsCount', sabd.sessions_count,
                            'uniqueUsersCount', sabd.unique_users_count,
                            'questionsCount', sabd.questions_count
                        ) ORDER BY sabd.activity_date DESC
                    ) FILTER (WHERE sabd.activity_date IS NOT NULL) as daily_activity,
                    json_agg(
                        jsonb_build_object(
                            'channel', cs.channel,
                            'sessionsCount', cs.sessions_count,
                            'questionsCount', cs.questions_count
                        ) ORDER BY cs.sessions_count DESC
                    ) FILTER (WHERE cs.channel IS NOT NULL) as channel_breakdown
                FROM session_stats ss
                CROSS JOIN consistent_session_count csc
                LEFT JOIN session_activity_by_day sabd ON true
                LEFT JOIN channel_stats cs ON true
                GROUP BY ss.total_sessions, ss.unique_users, ss.total_questions, 
                         ss.avg_questions_per_session, ss.avg_session_duration, 
                         ss.max_session_duration, ss.min_session_duration,
                         csc.total_sessions_all_activity
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
                avgSessionDuration: parseFloat(stats.avg_session_duration) || 0,
                maxSessionDuration: parseFloat(stats.max_session_duration) || 0,
                minSessionDuration: parseFloat(stats.min_session_duration) || 0,
                dailyActivity: stats.daily_activity || [],
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

module.exports = {
    getSessions,
    getSessionById,
    getSessionsByUserId,
    getSessionStats,
    getTotalSessionsCount,
    fetchSessionsFromDB,
    formatSessionData
};