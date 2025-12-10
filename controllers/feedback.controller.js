const pool = require('../services/db');
const { formatUTCToISTDate } = require('../utils/dateUtils');

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

    // Use utility function to format UTC to IST date
    const formattedDate = formatUTCToISTDate(dateObj);

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

        // SIMPLIFIED - Only return essential feedback counts
        const query = {
            text: `
                SELECT 
                    COUNT(*) as total_feedback,
                    COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as total_likes,
                    COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as total_dislikes
                FROM feedback
                WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
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
        console.error("Error fetching feedback stats:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching feedback statistics"
        });
    }
};

// Get feedback graph data for time-series visualization
const getFeedbackGraph = async (req, res) => {
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
                SELECT 
                    ${dateFormat} as date,
                    ${dateGrouping} as ${orderBy},
                    COUNT(*) as feedbackCount,
                    COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as likesCount,
                    COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as dislikesCount,
                    COUNT(DISTINCT uid) as uniqueUsersCount,
                    COUNT(DISTINCT sid) as uniqueSessionsCount,
                    COUNT(DISTINCT channel) as uniqueChannelsCount,
                    AVG(LENGTH(feedbacktext)) as avgFeedbackLength,
                    AVG(LENGTH(questiontext)) as avgQuestionLength,
                    AVG(LENGTH(answertext)) as avgAnswerLength,
                    ROUND(
                        COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) * 100.0 / 
                        NULLIF(COUNT(*), 0), 2
                    ) as satisfactionRate,
                    EXTRACT(EPOCH FROM ${dateGrouping}) * 1000 as timestamp,
                    ${granularity === 'hourly' ? `EXTRACT(HOUR FROM ${dateGrouping}) as hour_of_day` : 'NULL as hour_of_day'}
                FROM feedback
                WHERE feedbacktext IS NOT NULL 
                    AND questiontext IS NOT NULL 
                    AND ets IS NOT NULL
                    ${dateFilter}
                GROUP BY ${dateGrouping}
                ORDER BY ${orderBy} ASC
            `,
            values: queryParams
        };

        const result = await pool.query(query);

        // Format the data for frontend consumption
        const graphData = result.rows.map(row => ({
            date: row.date,
            timestamp: parseInt(row.timestamp),
            feedbackCount: parseInt(row.feedbackcount) || 0,
            likesCount: parseInt(row.likescount) || 0,
            dislikesCount: parseInt(row.dislikescount) || 0,
            uniqueUsersCount: parseInt(row.uniqueuserscount) || 0,
            uniqueSessionsCount: parseInt(row.uniquesessionscount) || 0,
            uniqueChannelsCount: parseInt(row.uniquechannelscount) || 0,
            avgFeedbackLength: parseFloat(row.avgfeedbacklength) || 0,
            avgQuestionLength: parseFloat(row.avgquestionlength) || 0,
            avgAnswerLength: parseFloat(row.avganswerLength) || 0,
            satisfactionRate: parseFloat(row.satisfactionrate) || 0,
            // Add formatted values for different time periods
            ...(granularity === 'hourly' && {
                hour: parseInt(row.hour_of_day) || parseInt(row.date?.split(' ')[1]?.split(':')[0] || '0')
            }),
            ...(granularity === 'weekly' && { week: row.date }),
            ...(granularity === 'monthly' && { month: row.date })
        }));

        // Calculate summary statistics
        const totalFeedback = graphData.reduce((sum, item) => sum + item.feedbackCount, 0);
        const totalLikes = graphData.reduce((sum, item) => sum + item.likesCount, 0);
        const totalDislikes = graphData.reduce((sum, item) => sum + item.dislikesCount, 0);
        const totalUniqueUsers = Math.max(...graphData.map(item => item.uniqueUsersCount), 0);
        const avgFeedbackPerPeriod = totalFeedback / Math.max(graphData.length, 1);
        const overallSatisfactionRate = totalFeedback > 0 ? (totalLikes * 100.0 / totalFeedback) : 0;

        // Find peak activity period
        const peakPeriod = graphData.reduce((max, item) =>
            item.feedbackCount > max.feedbackCount ? item : max,
            { feedbackCount: 0, date: null }
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
                    totalFeedback: totalFeedback,
                    totalLikes: totalLikes,
                    totalDislikes: totalDislikes,
                    totalUniqueUsers: totalUniqueUsers,
                    avgFeedbackPerPeriod: Math.round(avgFeedbackPerPeriod * 100) / 100,
                    overallSatisfactionRate: Math.round(overallSatisfactionRate * 100) / 100,
                    peakActivity: {
                        date: peakPeriod.date,
                        feedbackCount: peakPeriod.feedbackCount
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
        console.error('Error fetching feedback graph data:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
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
    getTotalLikesDislikesCount
};