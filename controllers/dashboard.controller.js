const pool = require('../services/db'); // adjust path as needed

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

/**
 * GET /dashboard/user-logins?granularity=daily|hourly
 * Returns user login analytics for dashboard
 */
const getUserLoginAnalytics = async (req, res) => {
    try {
        const granularity = req.query.granularity === 'hourly' ? 'hourly' : 'daily';

        if (granularity === 'daily') {
            // Last 7 days including today
            const result = await pool.query(`
                SELECT 
                    to_char(to_timestamp(ets / 1000)::date, 'YYYY-MM-DD') as date,
                    COUNT(DISTINCT uid) as unique_logins
                FROM (
                    SELECT uid, ets FROM questions WHERE uid IS NOT NULL
                    UNION ALL
                    SELECT uid, ets FROM errordetails WHERE uid IS NOT NULL
                ) AS combined
                WHERE to_timestamp(ets / 1000)::date >= CURRENT_DATE - INTERVAL '6 days'
                GROUP BY date
                ORDER BY date DESC
                LIMIT 7
            `);

            // Fill missing days with 0
            const today = new Date();
            const days = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                days.push(d.toISOString().slice(0, 10));
            }
            const dataMap = {};
            result.rows.forEach(row => { dataMap[row.date] = parseInt(row.unique_logins); });
            const data = days.map(date => ({
                date,
                uniqueLogins: dataMap[date] || 0
            }));

            return res.json({ success: true, granularity, data });
        } else {
            // Last 12 hours including current hour
            const result = await pool.query(`
                SELECT 
                    to_char(date_trunc('hour', to_timestamp(ets / 1000)), 'YYYY-MM-DD HH24:00') as hour,
                    COUNT(DISTINCT uid) as unique_logins
                FROM (
                    SELECT uid, ets FROM questions WHERE uid IS NOT NULL
                    UNION ALL
                    SELECT uid, ets FROM errordetails WHERE uid IS NOT NULL
                ) AS combined
                WHERE to_timestamp(ets / 1000) >= date_trunc('hour', now()) - INTERVAL '11 hours'
                GROUP BY hour
                ORDER BY hour DESC
                LIMIT 12
            `);

            // Fill missing hours with 0
            const now = new Date();
            const hours = [];
            for (let i = 11; i >= 0; i--) {
                const h = new Date(now);
                h.setHours(now.getHours() - i, 0, 0, 0);
                hours.push(h.toISOString().slice(0, 13) + ':00');
            }
            const dataMap = {};
            result.rows.forEach(row => { dataMap[row.hour] = parseInt(row.unique_logins); });
            const data = hours.map(hour => ({
                hour,
                uniqueLogins: dataMap[hour] || 0
            }));

            return res.json({ success: true, granularity, data });
        }
    } catch (error) {
        console.error('Error in getUserLoginAnalytics:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Get overall dashboard statistics combining all metrics
const getDashboardStats = async (req, res) => {
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
        
        // Simplified query to test basic functionality
        const query = {
            text: `
                WITH combined_stats AS (
                    SELECT 
                        COUNT(DISTINCT uid) as total_users,
                        COUNT(DISTINCT sid) as total_sessions,
                        COUNT(*) as total_questions,
                        COALESCE(AVG(LENGTH(questiontext)), 0) as avg_question_length,
                        COALESCE(AVG(LENGTH(answertext)), 0) as avg_answer_length,
                        COUNT(DISTINCT channel) as unique_channels
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                ),
                feedback_stats AS (
                    SELECT 
                        COUNT(*) as total_feedback,
                        COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as total_likes,
                        COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as total_dislikes,
                        COUNT(DISTINCT uid) as feedback_unique_users,
                        COALESCE(ROUND(
                            COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) * 100.0 / 
                            NULLIF(COUNT(*), 0), 2
                        ), 0) as satisfaction_rate
                    FROM feedback
                    WHERE uid IS NOT NULL ${feedbackDateFilter}
                ),
                daily_trends AS (
                    SELECT 
                        DATE(created_at) as activity_date,
                        COUNT(DISTINCT uid) as daily_users,
                        COUNT(DISTINCT sid) as daily_sessions,
                        COUNT(*) as daily_questions
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                    GROUP BY DATE(created_at)
                    ORDER BY activity_date DESC
                    LIMIT 7
                )
                SELECT 
                    cs.*,
                    fs.*,
                    COALESCE(json_agg(
                        jsonb_build_object(
                            'date', dt.activity_date,
                            'users', dt.daily_users,
                            'sessions', dt.daily_sessions,
                            'questions', dt.daily_questions
                        ) ORDER BY dt.activity_date DESC
                    ) FILTER (WHERE dt.activity_date IS NOT NULL), '[]'::json) as recent_trends
                FROM combined_stats cs
                CROSS JOIN feedback_stats fs
                LEFT JOIN daily_trends dt ON true
                GROUP BY cs.total_users, cs.total_sessions, cs.total_questions, 
                         cs.avg_question_length, cs.avg_answer_length, cs.unique_channels,
                         fs.total_feedback, fs.total_likes, fs.total_dislikes,
                         fs.feedback_unique_users, fs.satisfaction_rate
            `,
            values: queryParams
        };
        
        const result = await pool.query(query);
        const stats = result.rows[0];
        
        // Calculate derived metrics
        const engagementRate = stats.total_users > 0 ? 
            Math.round((stats.feedback_unique_users / stats.total_users) * 100) : 0;
        
        const avgQuestionsPerUser = stats.total_users > 0 ? 
            Math.round(stats.total_questions / stats.total_users) : 0;
        
        const avgQuestionsPerSession = stats.total_sessions > 0 ? 
            Math.round(stats.total_questions / stats.total_sessions) : 0;

        res.status(200).json({
            success: true,
            data: {
                // Core Metrics
                totalUsers: parseInt(stats.total_users) || 0,
                totalSessions: parseInt(stats.total_sessions) || 0,
                totalQuestions: parseInt(stats.total_questions) || 0,
                totalFeedback: parseInt(stats.total_feedback) || 0,
                
                // Feedback Metrics
                totalLikes: parseInt(stats.total_likes) || 0,
                totalDislikes: parseInt(stats.total_dislikes) || 0,
                satisfactionRate: parseFloat(stats.satisfaction_rate) || 0,
                
                // Engagement Metrics
                engagementRate: engagementRate,
                avgQuestionsPerUser: avgQuestionsPerUser,
                avgQuestionsPerSession: avgQuestionsPerSession,
                avgSessionDuration: 0, // Simplified for now
                
                // Content Metrics
                avgQuestionLength: parseFloat(stats.avg_question_length) || 0,
                avgAnswerLength: parseFloat(stats.avg_answer_length) || 0,
                uniqueChannels: parseInt(stats.unique_channels) || 0,
                
                // Trends and Breakdowns
                recentTrends: stats.recent_trends || [],
                topChannels: [] // Simplified for now
            },
            filters: {
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ 
            success: false,
            error: "Error fetching dashboard statistics" 
        });
    }
};

module.exports = {
    getUserLoginAnalytics,
    getDashboardStats,
    // ... existing exports ...
};
