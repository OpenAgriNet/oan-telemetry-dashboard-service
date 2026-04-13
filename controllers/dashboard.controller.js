const pool = require("../services/db"); // adjust path as needed
const {
  getTotalFeedbackCount,
  getTotalLikesDislikesCount,
} = require("./feedback.controller");
const { getTotalQuestionsCount } = require("./questions.controller");
const { getTotalSessionsCount } = require("./sessions.controller");
const { getTotalUsersCount } = require("./user.controller");
const { parseDateRange } = require("../utils/dateUtils");
const { buildChannelFilterClause, STATE_CONFIG } = require("../utils/stateAccess");

/**
 * GET /dashboard/user-logins?granularity=daily|hourly
 * Returns user login analytics for dashboard
 */
const getUserLoginAnalytics = async (req, res) => {
  try {
    const granularity = req.query.granularity === "hourly" ? "hourly" : "daily";

    if (granularity === "daily") {
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

// Get overall dashboard statistics - OPTIMIZED to return only essential metrics
const getDashboardStats = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
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

    const queryParams = [];
    let paramIndex = 0;
    const {
      clause: questionChannelClause,
      paramIndex: qChannelParamIndex,
    } = buildChannelFilterClause("q.channel", telemetryState, queryParams, paramIndex);
    paramIndex = qChannelParamIndex;
    const {
      clause: questionChannelClauseNoAlias,
      paramIndex: qNoAliasChannelParamIndex,
    } = buildChannelFilterClause("channel", telemetryState, queryParams, paramIndex);
    paramIndex = qNoAliasChannelParamIndex;
    const {
      clause: feedbackChannelClause,
      paramIndex: fChannelParamIndex,
    } = buildChannelFilterClause("channel", telemetryState, queryParams, paramIndex);
    paramIndex = fChannelParamIndex;
    const {
      clause: errorChannelClause,
      paramIndex: eChannelParamIndex,
    } = buildChannelFilterClause("channel", telemetryState, queryParams, paramIndex);
    paramIndex = eChannelParamIndex;

    let startParam = null;
    let endParam = null;

    if (startTimestamp !== null) {
      paramIndex += 1;
      startParam = paramIndex;
      queryParams.push(startTimestamp);
    }

    if (endTimestamp !== null) {
      paramIndex += 1;
      endParam = paramIndex;
      queryParams.push(endTimestamp);
    }

    const questionDateFilter = `
      ${startParam ? ` AND ets >= $${startParam}` : ""}
      ${endParam ? ` AND ets <= $${endParam}` : ""}
    `;
    const feedbackDateFilter = `
      ${startParam ? ` AND ets >= $${startParam}` : ""}
      ${endParam ? ` AND ets <= $${endParam}` : ""}
    `;
    const errorDateFilter = `
      ${startParam ? ` AND ets >= $${startParam}` : ""}
      ${endParam ? ` AND ets <= $${endParam}` : ""}
    `;
    const userDateFilter = `
      ${startParam ? ` AND period_first_seen >= TO_TIMESTAMP($${startParam} / 1000.0)` : ""}
      ${endParam ? ` AND period_first_seen <= TO_TIMESTAMP($${endParam} / 1000.0)` : ""}
    `;
    const query = {
      text: `
        WITH user_first_seen AS (
          SELECT
            q.fingerprint_id,
            MIN(TO_TIMESTAMP(q.ets / 1000.0)) AS first_seen_overall
          FROM questions q
          WHERE q.fingerprint_id IS NOT NULL
            AND ${questionChannelClause}
          GROUP BY q.fingerprint_id
        ),
        period_users AS (
          SELECT
            q.fingerprint_id,
            MIN(TO_TIMESTAMP(q.ets / 1000.0)) AS period_first_seen
          FROM questions q
          WHERE q.fingerprint_id IS NOT NULL
            AND q.answertext IS NOT NULL
            AND ${questionChannelClause}
            ${questionDateFilter}
          GROUP BY q.fingerprint_id
        ),
        user_stats AS (
          SELECT
            COUNT(DISTINCT pu.fingerprint_id) AS total_users,
            COUNT(DISTINCT CASE
              WHEN DATE(ufs.first_seen_overall) = DATE(pu.period_first_seen)
              THEN pu.fingerprint_id
            END) AS new_users,
            COUNT(DISTINCT CASE
              WHEN DATE(ufs.first_seen_overall) < DATE(pu.period_first_seen)
              THEN pu.fingerprint_id
            END) AS returning_users
          FROM period_users pu
          INNER JOIN user_first_seen ufs ON ufs.fingerprint_id = pu.fingerprint_id
        ),
        session_stats AS (
          WITH combined_sessions AS (
            SELECT sid, fingerprint_id AS uid, ets
            FROM questions
            WHERE sid IS NOT NULL
              AND answertext IS NOT NULL
              AND fingerprint_id IS NOT NULL
              AND ${questionChannelClauseNoAlias}
              ${questionDateFilter}
            UNION ALL
            SELECT sid, fingerprint_id AS uid, ets
            FROM feedback
            WHERE sid IS NOT NULL
              AND fingerprint_id IS NOT NULL
              AND ${feedbackChannelClause}
              ${feedbackDateFilter}
            UNION ALL
            SELECT sid, fingerprint_id AS uid, ets
            FROM errordetails
            WHERE sid IS NOT NULL
              AND fingerprint_id IS NOT NULL
              AND ${errorChannelClause}
              ${errorDateFilter}
          )
          SELECT COUNT(*) AS total_sessions
          FROM (
            SELECT sid, uid
            FROM combined_sessions
            GROUP BY sid, uid
          ) session_groups
        ),
        question_stats AS (
          SELECT COUNT(*) AS total_questions
          FROM questions
          WHERE answertext IS NOT NULL
            AND fingerprint_id IS NOT NULL
            AND ${questionChannelClauseNoAlias}
            ${questionDateFilter}
        ),
        feedback_stats AS (
          SELECT
            COUNT(*) AS total_feedback,
            COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) AS total_likes,
            COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) AS total_dislikes
          FROM feedback
          WHERE feedbacktext IS NOT NULL
            AND questiontext IS NOT NULL
            AND fingerprint_id IS NOT NULL
            AND ${feedbackChannelClause}
            ${feedbackDateFilter}
        )
        SELECT
          us.total_users,
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
      values: queryParams,
    };

    //     const total_questions = await getTotalQuestionsCount(null, startDate, endDate);
    //   const users = await getTotalUsersCount(null, startDate, endDate);
    //   const total_sessions = await getTotalSessionsCount(null, startDate, endDate);
    //   const total_feedback = await getTotalFeedbackCount(null, startDate, endDate);
    //   const feedbacks = await getTotalLikesDislikesCount(null, startDate, endDate);

    const result = await pool.query(query);
    const stats = result.rows[0];

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

// Get overall dashboard statistics for UNIFIED METRICS (always Bharat Vistaar)
const getDashboardStatsUnified = async (req, res) => {
  try {
    // Force Bharat Vistaar state for unified metrics
    const unifiedTelemetryState = STATE_CONFIG["bharat-vistaar"];
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

    const queryParams = [];
    let paramIndex = 0;
    const {
      clause: questionChannelClause,
      paramIndex: qChannelParamIndex,
    } = buildChannelFilterClause("q.channel", unifiedTelemetryState, queryParams, paramIndex);
    paramIndex = qChannelParamIndex;
    const {
      clause: questionChannelClauseNoAlias,
      paramIndex: qNoAliasChannelParamIndex,
    } = buildChannelFilterClause("channel", unifiedTelemetryState, queryParams, paramIndex);
    paramIndex = qNoAliasChannelParamIndex;
    const {
      clause: feedbackChannelClause,
      paramIndex: fChannelParamIndex,
    } = buildChannelFilterClause("channel", unifiedTelemetryState, queryParams, paramIndex);
    paramIndex = fChannelParamIndex;
    const {
      clause: errorChannelClause,
      paramIndex: eChannelParamIndex,
    } = buildChannelFilterClause("channel", unifiedTelemetryState, queryParams, paramIndex);
    paramIndex = eChannelParamIndex;

    let startParam = null;
    let endParam = null;

    if (startTimestamp !== null) {
      paramIndex += 1;
      startParam = paramIndex;
      queryParams.push(startTimestamp);
    }

    if (endTimestamp !== null) {
      paramIndex += 1;
      endParam = paramIndex;
      queryParams.push(endTimestamp);
    }

    const questionDateFilter = `
      ${startParam ? ` AND ets >= $${startParam}` : ""}
      ${endParam ? ` AND ets <= $${endParam}` : ""}
    `;
    const feedbackDateFilter = `
      ${startParam ? ` AND ets >= $${startParam}` : ""}
      ${endParam ? ` AND ets <= $${endParam}` : ""}
    `;
    const errorDateFilter = `
      ${startParam ? ` AND ets >= $${startParam}` : ""}
      ${endParam ? ` AND ets <= $${endParam}` : ""}
    `;
    
    const query = {
      text: `
        WITH user_first_seen AS (
          SELECT
            q.fingerprint_id,
            MIN(TO_TIMESTAMP(q.ets / 1000.0)) AS first_seen_overall
          FROM questions q
          WHERE q.fingerprint_id IS NOT NULL
            AND ${questionChannelClause}
          GROUP BY q.fingerprint_id
        ),
        period_users AS (
          SELECT
            q.fingerprint_id,
            MIN(TO_TIMESTAMP(q.ets / 1000.0)) AS period_first_seen
          FROM questions q
          WHERE q.fingerprint_id IS NOT NULL
            AND q.answertext IS NOT NULL
            AND ${questionChannelClause}
            ${questionDateFilter}
          GROUP BY q.fingerprint_id
        ),
        user_stats AS (
          SELECT
            COUNT(DISTINCT pu.fingerprint_id) AS total_users,
            COUNT(DISTINCT CASE
              WHEN DATE(ufs.first_seen_overall) = DATE(pu.period_first_seen)
              THEN pu.fingerprint_id
            END) AS new_users,
            COUNT(DISTINCT CASE
              WHEN DATE(ufs.first_seen_overall) < DATE(pu.period_first_seen)
              THEN pu.fingerprint_id
            END) AS returning_users
          FROM period_users pu
          INNER JOIN user_first_seen ufs ON ufs.fingerprint_id = pu.fingerprint_id
        ),
        session_stats AS (
          WITH combined_sessions AS (
            SELECT sid, fingerprint_id AS uid, ets
            FROM questions
            WHERE sid IS NOT NULL
              AND answertext IS NOT NULL
              AND fingerprint_id IS NOT NULL
              AND ${questionChannelClauseNoAlias}
              ${questionDateFilter}
            UNION ALL
            SELECT sid, fingerprint_id AS uid, ets
            FROM feedback
            WHERE sid IS NOT NULL
              AND fingerprint_id IS NOT NULL
              AND ${feedbackChannelClause}
              ${feedbackDateFilter}
            UNION ALL
            SELECT sid, fingerprint_id AS uid, ets
            FROM errordetails
            WHERE sid IS NOT NULL
              AND fingerprint_id IS NOT NULL
              AND ${errorChannelClause}
              ${errorDateFilter}
          )
          SELECT COUNT(*) AS total_sessions
          FROM (
            SELECT sid, uid
            FROM combined_sessions
            GROUP BY sid, uid
          ) session_groups
        ),
        question_stats AS (
          SELECT COUNT(*) AS total_questions
          FROM questions
          WHERE answertext IS NOT NULL
            AND fingerprint_id IS NOT NULL
            AND ${questionChannelClauseNoAlias}
            ${questionDateFilter}
        ),
        feedback_stats AS (
          SELECT
            COUNT(*) AS total_feedback,
            COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) AS total_likes,
            COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) AS total_dislikes
          FROM feedback
          WHERE feedbacktext IS NOT NULL
            AND questiontext IS NOT NULL
            AND fingerprint_id IS NOT NULL
            AND ${feedbackChannelClause}
            ${feedbackDateFilter}
        )
        SELECT
          us.total_users,
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
      values: queryParams,
    };

    const result = await pool.query(query);
    const stats = result.rows[0];

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
      filters: {
        startDate,
        endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
        appliedState: "bharat-vistaar",
      },
    });
  } catch (error) {
    console.error("Error fetching unified dashboard stats:", error);
    res
      .status(500)
      .json({ success: false, error: "Error fetching unified dashboard statistics" });
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
  getDashboardStatsUnified,
  getUserGraph,
};
