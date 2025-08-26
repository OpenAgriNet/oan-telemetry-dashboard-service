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
            // Last 40 days including today
            const result = await pool.query(`
                SELECT 
                    to_char(to_timestamp(ets / 1000)::date, 'YYYY-MM-DD') as date,
                    COUNT(DISTINCT uid) as unique_logins,
                    array_agg(DISTINCT uid) as uids
                FROM (
                    SELECT uid, ets FROM questions WHERE uid IS NOT NULL
                    UNION ALL
                    SELECT uid, ets FROM errordetails WHERE uid IS NOT NULL
                ) AS combined
                WHERE to_timestamp(ets / 1000)::date >= CURRENT_DATE - INTERVAL '7 days'
                GROUP BY date
                ORDER BY date DESC
            `);

            // Fill missing days with 0 and empty array for uids
            const today = new Date();
            const days = [];
            for (let i = 7; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                days.push(d.toISOString().slice(0, 10));
            }
            const dataMap = {};
            result.rows.forEach(row => { 
                dataMap[row.date] = {
                    uniqueLogins: parseInt(row.unique_logins),
                    uids: row.uids || []
                };
            });
            const data = days.map(date => ({
                date,
                uniqueLogins: dataMap[date]?.uniqueLogins || 0,
                uids: dataMap[date]?.uids || []
            }));

            return res.json({ success: true, granularity, data });
        } else {
            // Last 12 hours including current hour
            const result = await pool.query(`
                WITH combined AS (
                    SELECT uid, ets FROM questions WHERE uid IS NOT NULL
                    UNION ALL
                    SELECT uid, ets FROM errordetails WHERE uid IS NOT NULL
                ),
                logins AS (
                    SELECT 
                        date_trunc('hour', to_timestamp(ets / 1000)) AS hour,
                        uid
                    FROM combined
                    WHERE to_timestamp(ets / 1000) >= date_trunc('hour', now()) - INTERVAL '11 hours'
                )
                SELECT 
                    hour,
                    COUNT(DISTINCT uid) AS unique_logins
                FROM logins
                GROUP BY hour
                ORDER BY hour DESC
            `);
            console.log(result.rows);
        
            // Get current time and generate past 12 hourly time slots
            const now = new Date();
            const hours = [];
            for (let i = 11; i >= 0; i--) {
                const h = new Date(now);
                h.setHours(now.getHours() - i, 0, 0, 0);
                hours.push(h.toISOString().slice(0, 13) + ':00'); // Format: YYYY-MM-DD HH:00
            }
        
            // Build a map of hour => unique login count
            const dataMap = {};
            result.rows.forEach(row => {
                const hour = new Date(row.hour).toISOString().slice(0, 13) + ':00';
                dataMap[hour] = parseInt(row.unique_logins, 10);
            });
        
            // Map all 12 hours, filling missing hours with 0
            const data = hours.map(hour => ({
                hour,
                uniqueLogins: dataMap[hour] || 0
            }));
        
            return res.json({ success: true, granularity: 'hourly', data });
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
        
        // Validate date range and apply default start date logic (same as user controller)
        let { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        
        // Default to May 1st, 2025 if no start date provided (matching user controller logic)
        // Note: Frontend can override this by passing a startDate parameter
        if (!startDate) {
            startTimestamp = new Date('2025-05-01').getTime();
        }
        
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({ 
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp" 
            });
        }
        
        // Build date filtering (same as user controller)
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
        
        // Use the exact same logic as user controller for consistency
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
                all_user_activity AS (
                    SELECT uid, sid, ets FROM questions WHERE uid IS NOT NULL AND ets IS NOT NULL
                    UNION ALL
                    SELECT uid, sid, ets FROM errordetails WHERE uid IS NOT NULL AND ets IS NOT NULL
                ),
                overall_stats AS (
                    SELECT 
                        COUNT(DISTINCT uid) as total_users,
                        COUNT(DISTINCT sid) as total_sessions,
                        COUNT(*) as total_activity_records
                    FROM all_user_activity
                    WHERE 1=1 ${dateFilter}
                ),
                question_stats AS (
                    SELECT 
                        COUNT(*) as total_questions,
                        COALESCE(AVG(LENGTH(questiontext)), 0) as avg_question_length,
                        COALESCE(AVG(LENGTH(answertext)), 0) as avg_answer_length,
                        COUNT(DISTINCT channel) as unique_channels
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
                        COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as total_dislikes,
                        COUNT(DISTINCT uid) as feedback_unique_users,
                        COALESCE(ROUND(
                            COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) * 100.0 / 
                            NULLIF(COUNT(*), 0), 2
                        ), 0) as satisfaction_rate
                    FROM feedback
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${feedbackDateFilter}
                ),
                activity_by_day AS (
                    SELECT 
                        DATE(created_at) as activity_date,
                        COUNT(DISTINCT uid) as active_users,
                        COUNT(*) as questions_count
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                    GROUP BY DATE(created_at)
                    ORDER BY activity_date DESC
                    LIMIT 7
                ),
                channel_stats AS (
                    SELECT 
                        channel,
                        COUNT(DISTINCT uid) as users,
                        COUNT(DISTINCT sid) as sessions,
                        COUNT(*) as questions
                    FROM questions
                    WHERE uid IS NOT NULL AND answertext IS NOT NULL AND channel IS NOT NULL ${dateFilter}
                    GROUP BY channel
                    ORDER BY users DESC
                    LIMIT 5
                )
                SELECT 
                    os.total_users,
                    os.total_sessions,
                    qs.total_questions,
                    asd.avg_session_duration,
                    fs.total_feedback,
                    fs.total_likes,
                    fs.total_dislikes,
                    fs.satisfaction_rate,
                    qs.avg_question_length,
                    qs.avg_answer_length,
                    qs.unique_channels,
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'date', abd.activity_date,
                            'users', abd.active_users,
                            'sessions', abd.active_users, -- Approximation for now
                            'questions', abd.questions_count
                        ) ORDER BY jsonb_build_object(
                            'date', abd.activity_date,
                            'users', abd.active_users,
                            'sessions', abd.active_users,
                            'questions', abd.questions_count
                        ) -> 'date' DESC
                    ) FILTER (WHERE abd.activity_date IS NOT NULL) as recent_trends,
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'channel', cs.channel,
                            'users', cs.users,
                            'sessions', cs.sessions,
                            'questions', cs.questions
                        ) ORDER BY jsonb_build_object(
                            'channel', cs.channel,
                            'users', cs.users,
                            'sessions', cs.sessions,
                            'questions', cs.questions
                        ) -> 'users' DESC
                    ) FILTER (WHERE cs.channel IS NOT NULL) as top_channels
                FROM overall_stats os
                CROSS JOIN question_stats qs
                CROSS JOIN avg_session_duration asd
                CROSS JOIN feedback_stats fs
                LEFT JOIN activity_by_day abd ON true
                LEFT JOIN channel_stats cs ON true
                GROUP BY os.total_users, os.total_sessions, qs.total_questions, 
                         asd.avg_session_duration, fs.total_feedback, fs.total_likes, fs.total_dislikes,
                         fs.satisfaction_rate, qs.avg_question_length, qs.avg_answer_length, qs.unique_channels
            `,
            values: queryParams
        };
        
        const result = await pool.query(query);
        const stats = result.rows[0];
        
        // Calculate derived metrics (consistent with user controller)
        const engagementRate = stats.total_users > 0 ? 
            Math.round((stats.feedback_unique_users / stats.total_users) * 100) : 0;
        
        const avgQuestionsPerUser = stats.total_users > 0 ? 
            parseFloat((stats.total_questions / stats.total_users).toFixed(2)) : 0;
        
        const avgQuestionsPerSession = stats.total_sessions > 0 ? 
            parseFloat((stats.total_questions / stats.total_sessions).toFixed(2)) : 0;

        res.status(200).json({
            success: true,
            data: {
                // Core Metrics (using same logic as user controller)
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
                avgSessionDuration: parseFloat(stats.avg_session_duration) || 0,
                
                // Content Metrics
                avgQuestionLength: parseFloat(stats.avg_question_length) || 0,
                avgAnswerLength: parseFloat(stats.avg_answer_length) || 0,
                uniqueChannels: parseInt(stats.unique_channels) || 0,
                
                // Trends and Breakdowns
                recentTrends: stats.recent_trends || [],
                topChannels: stats.top_channels || []
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
const getUserGraph = async (req, res) => {
    console.log("getUserGraph");
    try {
        res.status(200).json({
            success: true,
            data: 'test'
        });
    } catch (error) {
        console.error("Error fetching user graph:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching user graph"
        });
    }
};

module.exports = {
    getUserLoginAnalytics,
    getDashboardStats,
    getUserGraph
};
