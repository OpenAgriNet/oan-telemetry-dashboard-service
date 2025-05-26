const pool = require('../services/db');
const { v4: uuidv4 } = require('uuid');

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

async function fetchUsersFromDB(page = 1, limit = 10, search = '', startDate = null, endDate = null) {
    const offset = (page - 1) * limit;
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
    // Base query with comprehensive user statistics and date filtering - using parameterized queries
    let query = `
        WITH user_stats AS (
            SELECT 
                uid as user_id,
                COUNT(DISTINCT sid) as session_count,
                COUNT(*) as total_questions,
                MAX(ets) as latest_session,
                MIN(ets) as first_session,
                MAX(created_at) as last_activity,
                (
                    SELECT sid FROM questions q2
                    WHERE q2.uid = questions.uid
                    ${startTimestamp !== null ? 'AND q2.ets >= $' + (paramIndex > 0 ? 1 : 0) : ''}
                    ${endTimestamp !== null ? 'AND q2.ets <= $' + (paramIndex > 1 ? 2 : 0) : ''}
                    ORDER BY q2.ets DESC
                    LIMIT 1
                ) as latest_sid
            FROM questions
            WHERE uid IS NOT NULL AND answertext IS NOT NULL
    `;
    
    const queryParams = [];
    let paramIndex = 0;
    
    // Add date range filtering to questions
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
    
    query += `
            GROUP BY uid
        ),
        user_feedback AS (
            SELECT 
                uid as user_id,
                COUNT(*) as feedback_count,
                COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as likes,
                COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as dislikes
            FROM feedback
            WHERE uid IS NOT NULL AND answertext IS NOT NULL
    `;
    
    // Add same date filtering to feedback
    if (startTimestamp !== null) {
        query += ` AND ets >= $${paramIndex - 1}`;
    }
    
    if (endTimestamp !== null) {
        query += ` AND ets <= $${paramIndex}`;
    }
    
    query += `
            GROUP BY uid
        )
        SELECT 
            us.user_id,
            us.session_count,
            us.total_questions,
            us.latest_session,
            us.first_session,
            us.last_activity,
            us.latest_sid,
            COALESCE(uf.feedback_count, 0) as feedback_count,
            COALESCE(uf.likes, 0) as likes,
            COALESCE(uf.dislikes, 0) as dislikes
        FROM user_stats us
        LEFT JOIN user_feedback uf ON us.user_id = uf.user_id
    `;
    
    // Add search functionality if search term is provided
    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` WHERE us.user_id ILIKE $${paramIndex}`;
        queryParams.push(`%${search.trim()}%`);
    }
    
    query += ` ORDER BY us.latest_session DESC`;
    
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

async function getTotalUsersCount(search = '', startDate = null, endDate = null) {
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
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
    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` AND uid ILIKE $${paramIndex}`;
        queryParams.push(`%${search.trim()}%`);
    }
    
    const result = await pool.query(query, queryParams);
    return parseInt(result.rows[0].total);
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
        latestSid: row.latest_sid || null
    };
}

const getUsers = async (req, res) => {
    try {
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

        // Fetch paginated users data and total count
        const [usersData, totalCount] = await Promise.all([
            fetchUsersFromDB(page, limit, search, startDate, endDate),
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
            dateFilter += ` AND ets >= ${paramIndex}`;
            feedbackDateFilter += ` AND ets >= ${paramIndex}`;
            queryParams.push(startTimestamp);
        }
        
        if (endTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets <= ${paramIndex}`;
            feedbackDateFilter += ` AND ets <= ${paramIndex}`;
            queryParams.push(endTimestamp);
        }
        
        // If date filtering is applied, use it for activity as well
        if (startTimestamp !== null || endTimestamp !== null) {
            activityDateFilter = 'WHERE true';
            if (startTimestamp !== null) {
                activityDateFilter += ` AND ets >= ${paramIndex - 1}`;
            }
            if (endTimestamp !== null) {
                activityDateFilter += ` AND ets <= ${paramIndex}`;
            }
        }
        
        const query = {
            text: `
                WITH overall_stats AS (
                    SELECT 
                        COUNT(DISTINCT uid) as total_users,
                        COUNT(DISTINCT sid) as total_sessions,
                        COUNT(*) as total_questions,
                        AVG(EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))) as avg_session_duration
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
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
                    fs.*,
                    json_agg(
                        json_build_object(
                            'date', abd.activity_date,
                            'activeUsers', abd.active_users,
                            'questionsCount', abd.questions_count
                        ) ORDER BY abd.activity_date DESC
                    ) as daily_activity
                FROM overall_stats os
                CROSS JOIN feedback_stats fs
                LEFT JOIN activity_by_day abd ON true
                GROUP BY os.total_users, os.total_sessions, os.total_questions, 
                         os.avg_session_duration, fs.total_feedback, fs.total_likes, fs.total_dislikes
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
                totalDislikes: parseInt(stats.total_dislikes) || 0,
                avgSessionDuration: parseFloat(stats.avg_session_duration) || 0,
                dailyActivity: stats.daily_activity || []
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

module.exports = {
    getUsers,
    getUserByUsername,
    getUserStats,
    getTotalUsersCount,
    fetchUsersFromDB,
    formatUserData
};