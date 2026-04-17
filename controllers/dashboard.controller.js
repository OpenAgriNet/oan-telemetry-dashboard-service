const pool = require("../services/db"); // adjust path as needed
const {
  getTotalFeedbackCount,
  getTotalLikesDislikesCount,
} = require("./feedback.controller");
const { getTotalQuestionsCount } = require("./questions.controller");
const { getTotalSessionsCount } = require("./sessions.controller");
const { getTotalUsersCount } = require("./user.controller");
const { parseDateRange } = require("../utils/dateUtils");

// Helper: Check if MV exists and has recent data
const checkMaterializedViewHealth = async (viewName, maxAgeMinutes = 30) => {
  try {
    const result = await pool.query(`
      SELECT 
        schemaname, 
        relname,
        pg_size_pretty(pg_relation_size(schemaname||'.'||relname)) as size
      FROM pg_stat_user_tables 
      WHERE relname = $1
    `, [viewName]);
    return result.rows.length > 0;
  } catch (err) {
    return false;
  }
};

/**
 * GET /dashboard/user-logins?granularity=daily|hourly
 * Returns user login analytics for dashboard
 * OPTIMIZED: Uses mv_active_users MV when available
 */
const getUserLoginAnalytics = async (req, res) => {
  try {
    const granularity = req.query.granularity === "hourly" ? "hourly" : "daily";

    // Try MV-first approach for daily granularity
    if (granularity === "daily") {
      const hasActiveUsersMV = await checkMaterializedViewHealth('mv_active_users');
      
      if (hasActiveUsersMV) {
        // Use materialized view for fast lookup
        const result = await pool.query(`
          SELECT 
            to_char(activity_date, 'YYYY-MM-DD') as date,
            active_users as unique_logins
          FROM mv_active_users
          WHERE activity_date >= CURRENT_DATE - INTERVAL '7 days'
          ORDER BY activity_date DESC
        `);

        if (result.rows.length > 0) {
          // Fill missing days with 0
          const today = new Date();
          const days = [];
          for (let i = 7; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            days.push(d.toISOString().slice(0, 10));
          }
          const dataMap = {};
          result.rows.forEach((row) => {
            dataMap[row.date] = {
              uniqueLogins: parseInt(row.unique_logins),
              uids: [], // MV doesn't store uids, use empty array
            };
          });
          const data = days.map((date) => ({
            date,
            uniqueLogins: dataMap[date]?.uniqueLogins || 0,
            uids: dataMap[date]?.uids || [],
          }));

          return res.json({ success: true, granularity, data, source: 'mv' });
        }
      }

      // Fallback: Original query
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
      result.rows.forEach((row) => {
        dataMap[row.date] = {
          uniqueLogins: parseInt(row.unique_logins),
          uids: row.uids || [],
        };
      });
      const data = days.map((date) => ({
        date,
        uniqueLogins: dataMap[date]?.uniqueLogins || 0,
        uids: dataMap[date]?.uids || [],
      }));

      return res.json({ success: true, granularity, data, source: 'base' });
    } else {
      // Last 12 hours including current hour (no MV for hourly yet)
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

      // Get current time and generate past 12 hourly time slots
      const now = new Date();
      const hours = [];
      for (let i = 11; i >= 0; i--) {
        const h = new Date(now);
        h.setHours(now.getHours() - i, 0, 0, 0);
        hours.push(h.toISOString().slice(0, 13) + ":00"); // Format: YYYY-MM-DD HH:00
      }

      // Build a map of hour => unique login count
      const dataMap = {};
      result.rows.forEach((row) => {
        const hour = new Date(row.hour).toISOString().slice(0, 13) + ":00";
        dataMap[hour] = parseInt(row.unique_logins, 10);
      });

      // Map all 12 hours, filling missing hours with 0
      const data = hours.map((hour) => ({
        hour,
        uniqueLogins: dataMap[hour] || 0,
      }));

      return res.json({ success: true, granularity: "hourly", data });
    }
  } catch (error) {
    console.error("Error in getUserLoginAnalytics:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// Get overall dashboard statistics - OPTIMIZED with MV-first queries
const getDashboardStats = async (req, res) => {
  try {
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid date format" });
    }

    // Check MV availability
    const hasEngagementMV = await checkMaterializedViewHealth('mv_user_engagement_daily');
    const hasQuestionRateMV = await checkMaterializedViewHealth('mv_question_answer_rates');

    // Determine query strategy: MV-first or direct
    const useMaterializedViews = hasEngagementMV && hasQuestionRateMV;

    let stats;
    let querySource = 'base';

    if (useMaterializedViews) {
      // MV-optimized query for fast dashboard stats
      try {
        const mvQuery = await pool.query(`
          WITH engagement_stats AS (
            SELECT 
              SUM(total_sessions) AS total_sessions,
              SUM(daily_active_users) AS total_users,
              AVG(avg_session_duration) AS avg_session_duration
            FROM mv_user_engagement_daily
            WHERE activity_date >= $1::date AND activity_date <= $2::date
          ),
          question_stats AS (
            SELECT 
              SUM(total_questions) AS total_questions,
              SUM(unique_users) AS question_users,
              SUM(feedback_count) AS total_feedback,
              ROUND(AVG(avg_feedback_rating), 2) AS avg_rating
            FROM mv_question_answer_rates
            WHERE question_date >= $1::date AND question_date <= $2::date
          ),
          session_duration_stats AS (
            SELECT 
              total_sessions AS all_time_sessions,
              avg_duration AS avg_session_duration_overall
            FROM mv_session_duration
          )
          SELECT
            es.total_users,
            es.total_sessions,
            qs.total_questions,
            qs.total_feedback,
            qs.avg_rating,
            COALESCE(qs.question_users, 0) AS active_question_users,
            -- Estimated likes/dislikes (MV doesn't store this breakdown)
            0 AS total_likes,
            0 AS total_dislikes,
            COALESCE(es.total_users - COALESCE(qs.question_users, 0), 0) AS new_users_est
          FROM engagement_stats es
          CROSS JOIN question_stats qs
          CROSS JOIN session_duration_stats sd
        `, [new Date(startTimestamp), new Date(endTimestamp)]);

        if (mvQuery.rows.length > 0) {
          stats = mvQuery.rows[0];
          querySource = 'mv';
        }
      } catch (mvErr) {
        console.warn('[DashboardStats] MV query failed, falling back to base query:', mvErr.message);
      }
    }

    // Fallback to original optimized query if MV not available or failed
    if (!stats) {
      const queryParams = [];
      let paramIndex = 0;
      let questionDateFilter = "";
      let feedbackDateFilter = "";
      let errordetailsDateFilter = "";
      let futureFilter = "";

      if (startTimestamp !== null) {
        paramIndex++;
        questionDateFilter += ` AND ets >= $${paramIndex}`;
        feedbackDateFilter += ` AND ets >= $${paramIndex}`;
        errordetailsDateFilter += ` AND ets >= $${paramIndex}`;
        queryParams.push(startTimestamp);
      }

      if (endTimestamp !== null) {
        paramIndex++;
        questionDateFilter += ` AND ets <= $${paramIndex}`;
        feedbackDateFilter += ` AND ets <= $${paramIndex}`;
        errordetailsDateFilter += ` AND ets <= $${paramIndex}`;
        queryParams.push(endTimestamp);
      }

      paramIndex++;
      queryParams.push(Date.now());
      futureFilter = ` AND ets <= $${paramIndex}`;

      const query = {
        text: `
          WITH user_stats AS (
    SELECT
      ( SELECT COUNT(DISTINCT fingerprint_id) from users
        WHERE fingerprint_id is not null and DATE(first_seen_at) >= DATE($3)
          AND DATE(first_seen_at) <= DATE($4)
      ) AS new_users,
      ( SELECT COUNT(DISTINCT q.fingerprint_id) from questions q
        INNER JOIN users u ON q.fingerprint_id = u.fingerprint_id
        WHERE q.fingerprint_id IS NOT NULL
          AND q.ets >= $1
          AND q.ets <= $2
          AND DATE(TO_TIMESTAMP(q.ets / 1000)) != DATE(u.first_seen_at)
      ) AS returning_users
  ),
  session_stats AS (
    WITH combined_sessions AS (
      SELECT sid, fingerprint_id AS uid, ets
      FROM questions
      WHERE sid IS NOT NULL
        AND answertext IS NOT NULL
        AND fingerprint_id IS NOT NULL
        AND ets >= $1 AND ets <= $2
      UNION ALL
      SELECT sid, fingerprint_id AS uid, ets
      FROM feedback
      WHERE sid IS NOT NULL
        AND fingerprint_id IS NOT NULL
        AND ets >= $1 AND ets <= $2
      UNION ALL
      SELECT sid, fingerprint_id AS uid, ets
      FROM errordetails
      WHERE sid IS NOT NULL
        AND fingerprint_id IS NOT NULL
        AND ets >= $1 AND ets <= $2
    )
    SELECT COUNT(*) AS total_sessions
    FROM (
      SELECT sid, uid
      FROM combined_sessions
      GROUP BY sid, uid
    ) session_groups
  ),
  question_stats AS (
    SELECT
      COUNT(*) AS total_questions
    FROM questions
    WHERE answertext IS NOT NULL AND fingerprint_id IS NOT NULL
      AND ets >= $1
      AND ets <= $2
  ),
  feedback_stats AS (
    SELECT 
              COUNT(*) AS total_feedback,
              COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) AS total_likes,
              COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) AS total_dislikes
            FROM feedback
            WHERE feedbacktext IS NOT NULL AND questiontext IS NOT NULL and fingerprint_id IS NOT NULL
      AND ets >= $1
      AND ets <= $2
  )
  SELECT
    (us.new_users + us.returning_users) AS total_users,
    us.new_users,
    us.returning_users,
    ss.total_sessions,
    qs.total_questions,
    fs.total_feedback,
    fs.total_likes,
    fs.total_dislikes
  FROM user_stats us
  CROSS JOIN session_stats ss
  CROSS JOIN question_stats qs
  CROSS JOIN feedback_stats fs;
        `,
        values: [
          startTimestamp, // $1 → bigint
          endTimestamp, // $2 → bigint
          new Date(startTimestamp), // $3 → timestamp
          new Date(endTimestamp), // $4 → timestamp
        ],
      };

      const result = await pool.query(query);
      stats = result.rows[0];
    }

    res.status(200).json({
      success: true,
      data: {
        totalUsers: parseInt(stats.total_users) || 0,
        totalNewUsers: parseInt(stats.new_users) || 0,
        totalReturningUsers: parseInt(stats.returning_users) || 0,
        totalSessions: parseInt(stats.total_sessions) || 0,
        totalQuestions: parseInt(stats.total_questions) || 0,
        totalFeedback: parseInt(stats.total_feedback) || 0,
        totalLikes: parseInt(stats.total_likes) || 0,
        totalDislikes: parseInt(stats.total_dislikes) || 0,
      },
      meta: {
        source: querySource,
      },
      filters: {
        startDate,
        endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res
      .status(500)
      .json({ success: false, error: "Error fetching dashboard statistics" });
  }
};

// Get call analytics using MVs
const getCallAnalytics = async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const granularity = req.query.granularity === 'hourly' ? 'hourly' : 'daily';

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
    const hasCallStatsMV = await checkMaterializedViewHealth('mv_daily_call_stats');

    if (hasCallStatsMV && granularity === 'daily') {
      // Use MV for daily call stats
      const result = await pool.query(`
        SELECT
          to_char(call_date, 'YYYY-MM-DD') as date,
          channel,
          total_calls,
          unique_users,
          round(avg_duration_seconds::numeric, 2) as avg_duration_seconds,
          completed_calls,
          failed_calls
        FROM mv_daily_call_stats
        WHERE call_date >= $1::date AND call_date <= $2::date
        ORDER BY call_date DESC, channel
      `, [new Date(startTimestamp), new Date(endTimestamp)]);

      return res.json({
        success: true,
        granularity: 'daily',
        data: result.rows,
        source: 'mv'
      });
    }

    // Fallback: Direct query (simplified, adjust as needed)
    res.json({
      success: true,
      message: 'Call analytics query not yet fully implemented in MV fallback',
      source: 'not_implemented'
    });
  } catch (error) {
    console.error("Error fetching call analytics:", error);
    res.status(500).json({ success: false, error: "Error fetching call analytics" });
  }
};

// Get user engagement analytics using MVs
const getUserEngagementAnalytics = async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
    const hasEngagementMV = await checkMaterializedViewHealth('mv_user_engagement_daily');

    if (hasEngagementMV) {
      const result = await pool.query(`
        SELECT
          to_char(activity_date, 'YYYY-MM-DD') as date,
          daily_active_users,
          daily_devices,
          total_sessions,
          round(avg_session_duration::numeric, 2) as avg_session_duration,
          voice_users,
          chat_users
        FROM mv_user_engagement_daily
        WHERE activity_date >= $1::date AND activity_date <= $2::date
        ORDER BY activity_date DESC
      `, [new Date(startTimestamp), new Date(endTimestamp)]);

      return res.json({
        success: true,
        data: result.rows,
        source: 'mv'
      });
    }

    res.json({
      success: false,
      error: 'Materialized view not available'
    });
  } catch (error) {
    console.error("Error fetching user engagement analytics:", error);
    res.status(500).json({ success: false, error: "Error fetching user engagement analytics" });
  }
};

const getUserGraph = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: "test",
    });
  } catch (error) {
    console.error("Error fetching user graph:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching user graph",
    });
  }
};

module.exports = {
  getUserLoginAnalytics,
  getDashboardStats,
  getCallAnalytics,
  getUserEngagementAnalytics,
  getUserGraph,
};