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

async function fetchAllFeedbackFromDB(page = 1, limit = 10, search = '', startDate = null, endDate = null) {
    const offset = (page - 1) * limit;
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
    // Base query with optional search and date filtering - using parameterized queries
    let query = `
        SELECT 
            id,
            qid,
            uid as user_id,
            created_at,
            feedbacktype,   
            feedbacktext,
            questiontext,
            answertext,
            channel,
            sid as session_id,
            ets
        FROM feedback
        WHERE feedbacktext IS NOT NULL AND questiontext IS NOT NULL
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
    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` AND (
            feedbacktext ILIKE $${paramIndex} OR 
            questiontext ILIKE $${paramIndex} OR 
            answertext ILIKE $${paramIndex} OR
            uid ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${search.trim()}%`);
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

async function getTotalFeedbackCount(search = '', startDate = null, endDate = null) {
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
    let query = `
        SELECT COUNT(*) as total
        FROM feedback
        WHERE feedbacktext IS NOT NULL AND questiontext IS NOT NULL
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
    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` AND (
            feedbacktext ILIKE $${paramIndex} OR 
            questiontext ILIKE $${paramIndex} OR 
            answertext ILIKE $${paramIndex} OR
            uid ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${search.trim()}%`);
    }
    
    const result = await pool.query(query, queryParams);
    return parseInt(result.rows[0].total);
}

async function getTotalLikesDislikesCount(search = '', startDate = null, endDate = null, sessionId = null) {
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
    let query = `
        SELECT 
            SUM(CASE WHEN feedbacktype = 'like' THEN 1 ELSE 0 END) as total_likes,
            SUM(CASE WHEN feedbacktype = 'dislike' THEN 1 ELSE 0 END) as total_dislikes
        FROM feedback
        WHERE feedbacktext IS NOT NULL AND questiontext IS NOT NULL
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
    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` AND (
            feedbacktext ILIKE $${paramIndex} OR 
            questiontext ILIKE $${paramIndex} OR 
            answertext ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${search.trim()}%`);
    }
    
    const result = await pool.query(query, queryParams);
    return {
        totalLikes: parseInt(result.rows[0].total_likes) || 0,
        totalDislikes: parseInt(result.rows[0].total_dislikes) || 0
    };
}
    
function formatFeedbackData(feedbackItem) {
    const dateObj = new Date(feedbackItem.created_at);
    const formattedDate = dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });

    return {
        qid: feedbackItem.qid,
        date: formattedDate,
        user: feedbackItem.user_id,
        question: feedbackItem.questiontext,
        sessionId: feedbackItem.session_id,
        answer: feedbackItem.answertext.substring(0, 100) + "...",
        rating: feedbackItem.feedbacktype,
        feedback: feedbackItem.feedbacktext,
        id: feedbackItem.id,
        timestamp: feedbackItem.ets
    };
}

// Controller function to get all feedback with pagination, search, and date filtering
async function getAllFeedback(req, res) {
    try {
        // Extract and sanitize pagination parameters from query string
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const search = req.query.search ? String(req.query.search).trim() : '';
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        
        // Additional validation for search term length to prevent abuse
        if (search.length > 1000) {
            return res.status(400).json({ message: "Search term too long" });
        }
        
        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({ 
                message: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp" 
            });
        }
        
        if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
            return res.status(400).json({ 
                message: "Start date cannot be after end date" 
            });
        }

        // Fetch paginated feedback data and total count
        const [rawFeedbackData, totalCount] = await Promise.all([
            fetchAllFeedbackFromDB(page, limit, search, startDate, endDate),
            getTotalFeedbackCount(search, startDate, endDate)
        ]);

        const formattedFeedback = rawFeedbackData.map(formatFeedbackData);
        
        // Get accurate total likes and dislikes counts for the entire filtered dataset
        const { totalLikes, totalDislikes } = await getTotalLikesDislikesCount(search, startDate, endDate);
        
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
                uid AS user_id,
                sid AS session_id,
                groupdetails,
                channel,
                ets,
                feedbacktext,
                questiontext,
                answertext,
                feedbacktype,
                created_at,
                qid AS question_id
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
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        
        if (!id || !uuidRegex.test(id)) {
            return res.status(400).json({ message: "Valid UUID ID is required" });
        }
        
        const feedbackDetails = await fetchFeedbackByidFromDB(id);
        
        if (feedbackDetails.length === 0) {
            return res.status(404).json({ message: "No feedback found for the given ID" });
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
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        const offset = (page - 1) * limit;
        
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return res.status(400).json({ 
                message: "Valid Session ID is required" 
            });
        }
        
        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({ 
                message: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp" 
            });
        }
        
        if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
            return res.status(400).json({ 
                message: "Start date cannot be after end date" 
            });
        }
        
        // Build date filtering for feedback query
        let dateFilter = '';
        let countDateFilter = '';
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
                    uid as user_id,
                    created_at,
                    feedbacktype,   
                    feedbacktext,
                    questiontext,
                    answertext,
                    channel,
                    sid as session_id,
                    ets
                FROM feedback
                WHERE sid = $1 
                    AND feedbacktext IS NOT NULL 
                    AND questiontext IS NOT NULL
                    ${dateFilter}
                ORDER BY created_at DESC
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
                    AND questiontext IS NOT NULL
                    ${countDateFilter}
            `,
            values: countParams,
        };
        
        const [feedbackResult, countResult] = await Promise.all([
            pool.query(feedbackQuery),
            pool.query(countQuery)
        ]);
        
        const totalCount = parseInt(countResult.rows[0].total);
        const formattedData = feedbackResult.rows.map(formatFeedbackData);
        
        // Get accurate total likes and dislikes counts for the entire filtered session dataset
        const { totalLikes, totalDislikes } = await getTotalLikesDislikesCount('', startDate, endDate, sessionId.trim());
        
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
                previousPage: hasPreviousPage ? page - 1 : null
            },
            filters: {
                sessionId: sessionId.trim(),
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching feedback by session ID:", error);
        res.status(500).json({ 
            message: "Error fetching session feedback" 
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
                dailyActivity: stats.daily_activity || [],
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

module.exports = {
    getAllFeedback,
    getFeedbackByid,
    getFeedbackBySessionId,
    getFeedbackStats,
    getTotalFeedbackCount,
    fetchAllFeedbackFromDB,
    formatFeedbackData
};