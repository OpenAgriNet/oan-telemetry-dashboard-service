const pool = require('../services/db');
const { v4: uuidv4 } = require('uuid');

async function fetchUsersFromDB(page = 1, limit = 10, search = '') {
    const offset = (page - 1) * limit;
    
    // Base query with comprehensive user statistics - using parameterized queries
    let query = `
        WITH user_stats AS (
            SELECT 
                uid as user_id,
                COUNT(DISTINCT sid) as session_count,
                COUNT(*) as total_questions,
                MAX(ets) as latest_session,
                MIN(ets) as first_session,
                MAX(created_at) as last_activity
            FROM questions
            WHERE uid IS NOT NULL
            GROUP BY uid
        ),
        user_feedback AS (
            SELECT 
                uid as user_id,
                COUNT(*) as feedback_count,
                COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as likes,
                COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as dislikes
            FROM feedback
            WHERE uid IS NOT NULL
            GROUP BY uid
        )
        SELECT 
            us.user_id,
            us.session_count,
            us.total_questions,
            us.latest_session,
            us.first_session,
            us.last_activity,
            COALESCE(uf.feedback_count, 0) as feedback_count,
            COALESCE(uf.likes, 0) as likes,
            COALESCE(uf.dislikes, 0) as dislikes
        FROM user_stats us
        LEFT JOIN user_feedback uf ON us.user_id = uf.user_id
    `;
    
    const queryParams = [];
    
    // Add search functionality if search term is provided
    if (search && search.trim() !== '') {
        query += ` WHERE us.user_id ILIKE $1`;
        queryParams.push(`%${search.trim()}%`);
        
        query += ` ORDER BY us.latest_session DESC LIMIT $2 OFFSET $3`;
        queryParams.push(limit, offset);
    } else {
        query += ` ORDER BY us.latest_session DESC LIMIT $1 OFFSET $2`;
        queryParams.push(limit, offset);
    }

    const result = await pool.query(query, queryParams);
    return result.rows;
}

async function getTotalUsersCount(search = '') {
    let query = `
        SELECT COUNT(DISTINCT uid) as total
        FROM questions
        WHERE uid IS NOT NULL
    `;
    
    const queryParams = [];
    
    // Add search filter to count query if search term is provided
    if (search && search.trim() !== '') {
        query += ` AND uid ILIKE $1`;
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
        lastActivity: row.last_activity
    };
}

const getUsers = async (req, res) => {
    try {
        // Extract and sanitize pagination parameters from query string
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const search = req.query.search ? String(req.query.search).trim() : '';
        
        // Additional validation for search term length to prevent abuse
        if (search.length > 1000) {
            return res.status(400).json({ 
                success: false,
                error: "Search term too long" 
            });
        }

        // Fetch paginated users data and total count
        const [usersData, totalCount] = await Promise.all([
            fetchUsersFromDB(page, limit, search),
            getTotalUsersCount(search)
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
            search: search
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

// Get single user details by username
const getUserByUsername = async (req, res) => {
    try {
        const { username } = req.params;
        
        if (!username || typeof username !== 'string' || username.trim() === '') {
            return res.status(400).json({ 
                success: false,
                error: "Valid username is required" 
            });
        }
        
        // Get comprehensive user details
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
                    WHERE uid = $1
                    GROUP BY uid
                ),
                user_feedback AS (
                    SELECT 
                        uid,
                        COUNT(*) as feedback_count,
                        COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as likes,
                        COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as dislikes
                    FROM feedback
                    WHERE uid = $1
                    GROUP BY uid
                ),
                user_channels AS (
                    SELECT 
                        uid,
                        array_agg(DISTINCT channel) FILTER (WHERE channel IS NOT NULL) as channels
                    FROM (
                        SELECT uid, channel FROM questions WHERE uid = $1
                        UNION
                        SELECT uid, channel FROM feedback WHERE uid = $1
                    ) combined
                    GROUP BY uid
                )
                SELECT 
                    uq.uid as user_id,
                    uq.session_count,
                    uq.total_questions,
                    uq.latest_session,
                    uq.first_session,
                    uq.last_activity,
                    uq.channels_used,
                    COALESCE(uf.feedback_count, 0) as feedback_count,
                    COALESCE(uf.likes, 0) as likes,
                    COALESCE(uf.dislikes, 0) as dislikes,
                    uc.channels
                FROM user_questions uq
                LEFT JOIN user_feedback uf ON uq.uid = uf.uid
                LEFT JOIN user_channels uc ON uq.uid = uc.uid
            `,
            values: [username.trim()],
        };
        
        const result = await pool.query(query);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: "No user found for the given username" 
            });
        }
        
        const userData = formatUserData(result.rows[0]);
        // Add additional details for single user view
        userData.channelsUsed = result.rows[0].channels_used || 0;
        userData.channels = result.rows[0].channels || [];
        
        res.status(200).json({
            success: true,
            data: userData
        });
    } catch (error) {
        console.error("Error fetching user by username:", error);
        res.status(500).json({ 
            success: false,
            error: "Error fetching user data" 
        });
    }
};

// Get user statistics and activity summary
const getUserStats = async (req, res) => {
    try {
        const query = `
            WITH overall_stats AS (
                SELECT 
                    COUNT(DISTINCT uid) as total_users,
                    COUNT(DISTINCT sid) as total_sessions,
                    COUNT(*) as total_questions,
                    AVG(EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))) as avg_session_duration
                FROM questions
                WHERE uid IS NOT NULL
            ),
            feedback_stats AS (
                SELECT 
                    COUNT(*) as total_feedback,
                    COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as total_likes,
                    COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as total_dislikes
                FROM feedback
                WHERE uid IS NOT NULL
            ),
            activity_by_day AS (
                SELECT 
                    DATE(created_at) as activity_date,
                    COUNT(DISTINCT uid) as active_users,
                    COUNT(*) as questions_count
                FROM questions
                WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
                    AND uid IS NOT NULL
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
        `;
        
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
    getUserStats
};

