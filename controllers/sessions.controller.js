const pool = require('../services/db');
const { parseDateRange, formatDateToIST, getCurrentTimestamp } = require('../utils/dateUtils');

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

    // Add future ETS filter (filter out bad telemetry data with future timestamps)
    paramIndex++;
    const futureFilterParam = paramIndex;
    dateConditions += ` AND ets <= $${paramIndex}`;
    queryParams.push(Date.now());

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

    // Add future ETS filter (filter out bad telemetry data with future timestamps)
    paramIndex++;
    dateConditions += ` AND ets <= $${paramIndex}`;
    queryParams.push(Date.now());

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
                // Convert to IST timezone
                sessionTime = formatDateToIST(timestamp);
            } else {
                // If not a timestamp, try parsing as a date string
                const parsedDate = new Date(row.session_time);
                sessionTime = formatDateToIST(parsedDate.getTime());
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

        // SIMPLIFIED - Only return total sessions count
        const query = {
            text: `
                SELECT COUNT(DISTINCT session_user_pair) as total_sessions
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
            `,
            values: queryParams
        };

        const result = await pool.query(query);
        const stats = result.rows[0];

        res.status(200).json({
            success: true,
            data: {
                totalSessions: parseInt(stats.total_sessions) || 0
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

// Get sessions graph data for time-series visualization
const getSessionsGraph = async (req, res) => {
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
                sid ILIKE $${paramIndex} OR 
                uid ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${search.trim()}%`);
        }

        // Define the date truncation and formatting based on granularity
        let dateGrouping;
        let dateFormat;
        let orderBy;

        switch (granularity) {
            case 'hourly':
                dateGrouping = "DATE_TRUNC('hour', TO_TIMESTAMP(ets/1000))";
                dateFormat = "TO_CHAR(DATE_TRUNC('hour', TO_TIMESTAMP(ets/1000)), 'YYYY-MM-DD HH24:00')";
                orderBy = "hour_bucket";
                break;
            case 'weekly':
                dateGrouping = "DATE_TRUNC('week', TO_TIMESTAMP(ets/1000))";
                dateFormat = "TO_CHAR(DATE_TRUNC('week', TO_TIMESTAMP(ets/1000)), 'YYYY-MM-DD')";
                orderBy = "week_bucket";
                break;
            case 'monthly':
                dateGrouping = "DATE_TRUNC('month', TO_TIMESTAMP(ets/1000))";
                dateFormat = "TO_CHAR(DATE_TRUNC('month', TO_TIMESTAMP(ets/1000)), 'YYYY-MM')";
                orderBy = "month_bucket";
                break;
            case 'daily':
            default:
                dateGrouping = "DATE_TRUNC('day', TO_TIMESTAMP(ets/1000))";
                dateFormat = "TO_CHAR(DATE_TRUNC('day', TO_TIMESTAMP(ets/1000)), 'YYYY-MM-DD')";
                orderBy = "day_bucket";
                break;
        }

        const query = {
            text: `
                WITH combined_sessions AS (
                    SELECT 
                        sid,
                        uid,
                        ets,
                        ${dateGrouping} as time_bucket,
                        ${dateFormat} as date,
                        'question' as activity_type
                    FROM questions
                    WHERE sid IS NOT NULL AND uid IS NOT NULL AND answertext IS NOT NULL AND ets IS NOT NULL${dateFilter}
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        ets,
                        ${dateGrouping} as time_bucket,
                        ${dateFormat} as date,
                        'feedback' as activity_type
                    FROM feedback
                    WHERE sid IS NOT NULL AND uid IS NOT NULL AND ets IS NOT NULL${dateFilter}
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        ets,
                        ${dateGrouping} as time_bucket,
                        ${dateFormat} as date,
                        'error' as activity_type
                    FROM errordetails
                    WHERE sid IS NOT NULL AND uid IS NOT NULL AND ets IS NOT NULL${dateFilter}
                ),
                session_aggregates AS (
                    SELECT 
                        date,
                        time_bucket,
                        COUNT(DISTINCT CONCAT(sid, '_', uid)) as sessionsCount,
                        COUNT(DISTINCT uid) as uniqueUsersCount,
                        COUNT(DISTINCT sid) as uniqueSessionIdsCount,
                        COUNT(CASE WHEN activity_type = 'question' THEN 1 END) as questionsCount,
                        COUNT(CASE WHEN activity_type = 'feedback' THEN 1 END) as feedbackCount,
                        COUNT(CASE WHEN activity_type = 'error' THEN 1 END) as errorsCount,
                        EXTRACT(EPOCH FROM time_bucket) * 1000 as timestamp,
                        ${granularity === 'hourly' ? `EXTRACT(HOUR FROM time_bucket) as hour_of_day` : 'NULL as hour_of_day'}
                    FROM combined_sessions
                    GROUP BY time_bucket, date
                )
                SELECT 
                    date,
                    timestamp,
                    hour_of_day,
                    sessionsCount,
                    uniqueUsersCount,
                    uniqueSessionIdsCount,
                    questionsCount,
                    feedbackCount,
                    errorsCount,
                    CASE 
                        WHEN sessionsCount > 0 THEN ROUND(questionsCount::decimal / sessionsCount, 2)
                        ELSE 0 
                    END as avgQuestionsPerSession,
                    CASE 
                        WHEN sessionsCount > 0 THEN ROUND(feedbackCount::decimal / sessionsCount, 2)
                        ELSE 0 
                    END as avgFeedbackPerSession
                FROM session_aggregates
                ORDER BY time_bucket ASC
            `,
            values: queryParams
        };

        const result = await pool.query(query);

        // Format the data for frontend consumption
        const graphData = result.rows.map(row => ({
            date: row.date,
            timestamp: parseInt(row.timestamp),
            sessionsCount: parseInt(row.sessionscount) || 0,
            uniqueUsersCount: parseInt(row.uniqueuserscount) || 0,
            uniqueSessionIdsCount: parseInt(row.uniquesessionidscount) || 0,
            questionsCount: parseInt(row.questionscount) || 0,
            feedbackCount: parseInt(row.feedbackcount) || 0,
            errorsCount: parseInt(row.errorscount) || 0,
            avgQuestionsPerSession: parseFloat(row.avgquestionspersession) || 0,
            avgFeedbackPerSession: parseFloat(row.avgfeedbackpersession) || 0,
            // Add formatted values for different time periods
            ...(granularity === 'hourly' && {
                hour: parseInt(row.hour_of_day) || parseInt(row.date?.split(' ')[1]?.split(':')[0] || '0')
            }),
            ...(granularity === 'weekly' && { week: row.date }),
            ...(granularity === 'monthly' && { month: row.date })
        }));

        // Calculate summary statistics
        const totalSessions = graphData.reduce((sum, item) => sum + item.sessionsCount, 0);
        const totalQuestions = graphData.reduce((sum, item) => sum + item.questionsCount, 0);
        const totalUsers = Math.max(...graphData.map(item => item.uniqueUsersCount), 0);
        const avgSessionsPerPeriod = totalSessions / Math.max(graphData.length, 1);

        // Find peak activity period
        const peakPeriod = graphData.reduce((max, item) =>
            item.sessionsCount > max.sessionsCount ? item : max,
            { sessionsCount: 0, date: null }
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
                    totalSessions: totalSessions,
                    totalQuestions: totalQuestions,
                    totalUsers: totalUsers,
                    avgSessionsPerPeriod: Math.round(avgSessionsPerPeriod * 100) / 100,
                    peakActivity: {
                        date: peakPeriod.date,
                        sessionsCount: peakPeriod.sessionsCount
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
        console.error('Error fetching sessions graph data:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

module.exports = {
    getSessions,
    getSessionById,
    getSessionsByUserId,
    getSessionStats,
    getSessionsGraph,
    getTotalSessionsCount,
    fetchSessionsFromDB,
    formatSessionData
};