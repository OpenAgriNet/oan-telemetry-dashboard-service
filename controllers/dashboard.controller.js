const pool = require('../services/db'); // adjust path as needed
const { getTotalFeedbackCount, getTotalLikesDislikesCount } = require('./feedback.controller');
const { getTotalQuestionsCount } = require('./questions.controller');
const { getTotalSessionsCount } = require('./sessions.controller');
const { getTotalUsersCount } = require('./user.controller');

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

// Get overall dashboard statistics - OPTIMIZED to return only essential metrics
const getDashboardStats = async (req, res) => {
    try {
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

        // Validate date range - no default start date to ensure consistency across all pages
        let { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        
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

        // SIMPLIFIED QUERY - Only compute essential metrics actually used by the frontend
    //     const query = {
    //         text: `
    //                 WITH all_user_activity AS (
    //     SELECT uid, sid, ets FROM questions WHERE uid IS NOT NULL AND ets IS NOT NULL
    //     UNION ALL
    //     SELECT uid, sid, ets FROM errordetails WHERE uid IS NOT NULL AND ets IS NOT NULL
    // ),
    // overall_stats AS (
    //     SELECT 
    //         COUNT(DISTINCT uid) as total_users
    //     FROM all_user_activity
    //     WHERE 1=1 ${dateFilter}
    // ),
    // session_groups AS (
    //     SELECT 
    //         sid as session_id,
    //         uid as username,
    //         COUNT(questiontext) as question_count,
    //         MAX(ets) as session_time
    //     FROM questions
    //     WHERE sid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
    //     GROUP BY sid, uid
    // ),
    // session_stats AS (
    //     SELECT COUNT(*) as total_sessions
    //     FROM session_groups
    // ),
    // question_stats AS (
    //     SELECT 
    //         COUNT(*) as total_questions
    //     FROM questions
    //     WHERE uid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
    // ),
    // feedback_stats AS (
    //     SELECT 
    //         COUNT(*) as total_feedback,
    //         COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) as total_likes,
    //         COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) as total_dislikes
    //     FROM feedback
    //     WHERE feedbacktext IS NOT NULL AND questiontext IS NOT NULL ${feedbackDateFilter}
    // )
    // SELECT 
    //     os.total_users,
    //     ss.total_sessions,
    //     qs.total_questions,
    //     fs.total_feedback,
    //     fs.total_likes,
    //     fs.total_dislikes
    // FROM overall_stats os
    // CROSS JOIN session_stats ss
    // CROSS JOIN question_stats qs
    // CROSS JOIN feedback_stats fs
    //         `,
    //         values: queryParams
    //     };

      const total_questions = await getTotalQuestionsCount(null, startDate, endDate);
      const total_users = await getTotalUsersCount(null, startDate, endDate);
      const total_sessions = await getTotalSessionsCount(null, startDate, endDate);
      const total_feedback = await getTotalFeedbackCount(null, startDate, endDate);
      const feedbacks = await getTotalLikesDislikesCount(null, startDate, endDate);

        // const result = await pool.query(query);
        // const stats = result.rows[0];
    

        res.status(200).json({
            success: true,
            data: {
                // Core Metrics - only what's actually used by the frontend
                totalUsers: parseInt(total_users) || 0,
                totalSessions: parseInt(total_sessions) || 0,
                totalQuestions: parseInt(total_questions) || 0,
                totalFeedback: parseInt(total_feedback) || 0,
                totalLikes: parseInt(feedbacks?.totalLikes) || 0,
                totalDislikes: parseInt(feedbacks?.totalDislikes) || 0
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
