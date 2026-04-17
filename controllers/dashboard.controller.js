const pool = require("../services/db"); // adjust path as needed
const {
  getTotalFeedbackCount,
  getTotalLikesDislikesCount,
} = require("./feedback.controller");
const { getTotalQuestionsCount } = require("./questions.controller");
const { getTotalSessionsCount } = require("./sessions.controller");
const { getTotalUsersCount } = require("./user.controller");
const { parseDateRange } = require("../utils/dateUtils");

// Helper: Check if MV exists
const checkMaterializedViewHealth = async (viewName) => {
  try {
    const result = await pool.query(`
      SELECT relname
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
 * OPTIMIZED: Uses mv_active_users (computed from questions+errordetails) when available
 */
const getUserLoginAnalytics = async (req, res) => {
  try {
    const granularity = req.query.granularity === "hourly" ? "hourly" : "daily";

    if (granularity === "daily") {
      // Try MV-first approach
      const hasMV = await checkMaterializedViewHealth('mv_active_users');
      if (hasMV) {
        try {
          const result = await pool.query(`
            SELECT 
              to_char(activity_date, 'YYYY-MM-DD') as date,
              active_users as unique_logins
            FROM mv_active_users
            WHERE activity_date >= CURRENT_DATE - INTERVAL '7 days'
            ORDER BY activity_date DESC
          `);

          if (result.rows.length > 0) {
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
                uids: [], // MV doesn't store uids
              };
            });
            const data = days.map((date) => ({
              date,
              uniqueLogins: dataMap[date]?.uniqueLogins || 0,
              uids: dataMap[date]?.uids || [],
            }));

            return res.json({ success: true, granularity, data, source: 'mv' });
          }
        } catch (mvErr) {
          console.warn('[UserLoginAnalytics] MV query failed, falling back:', mvErr.message);
        }
      }

      // Fallback: direct query
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

// Get overall dashboard statistics
// OPTIMIZED: Uses mv_daily_session_counts + mv_question_answer_rates for the
// heaviest CTEs (sessions, questions, feedback). User stats (new/returning)
// still uses base query since it requires COUNT(DISTINCT) over the range.
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

    // Check MV availability for the heavy aggregations
    const [hasSessionMV, hasQuestionRateMV] = await Promise.all([
      checkMaterializedViewHealth('mv_daily_session_counts'),
      checkMaterializedViewHealth('mv_question_answer_rates'),
    ]);

    const useMVs = hasSessionMV && hasQuestionRateMV;

    let stats;
    let querySource = 'base';

    if (useMVs) {
      try {
        // MV-optimized: use pre-computed daily aggregates for sessions + questions.
        // Feedback is queried directly (voice feedback may not be in mv_question_answer_rates).
        // Only user_stats (new/returning) hits base tables with JOINs.
        const mvQuery = {
          text: `
            WITH user_stats AS (
              SELECT
                ( SELECT COUNT(DISTINCT fingerprint_id) FROM users
                  WHERE fingerprint_id IS NOT NULL
                    AND DATE(first_seen_at) >= DATE($3)
                    AND DATE(first_seen_at) <= DATE($4)
                ) AS new_users,
                ( SELECT COUNT(DISTINCT q.fingerprint_id) FROM questions q
                  INNER JOIN users u ON q.fingerprint_id = u.fingerprint_id
                  WHERE q.fingerprint_id IS NOT NULL
                    AND q.ets >= $1 AND q.ets <= $2
                    AND DATE(TO_TIMESTAMP(q.ets / 1000)) != DATE(u.first_seen_at)
                ) AS returning_users
            ),
            mv_sessions AS (
              SELECT COALESCE(SUM(session_count), 0) AS total_sessions
              FROM mv_daily_session_counts
              WHERE stat_date >= DATE($3) AND stat_date <= DATE($4)
            ),
            mv_questions AS (
              SELECT COALESCE(SUM(total_questions), 0) AS total_questions
              FROM mv_question_answer_rates
              WHERE question_date >= DATE($3) AND question_date <= DATE($4)
            ),
            feedback_stats AS (
              SELECT
                COUNT(*) AS total_feedback,
                COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) AS total_likes,
                COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) AS total_dislikes
              FROM feedback
              WHERE feedbacktext IS NOT NULL
                AND (
                  (questiontext IS NOT NULL AND fingerprint_id IS NOT NULL)
                  OR COALESCE(feedback_source, 'chat') = 'voice'
                )
                AND ets >= $1 AND ets <= $2
            )
            SELECT
              (us.new_users + us.returning_users) AS total_users,
              us.new_users,
              us.returning_users,
              ms.total_sessions,
              mq.total_questions,
              fs.total_feedback,
              fs.total_likes,
              fs.total_dislikes
            FROM user_stats us
            CROSS JOIN mv_sessions ms
            CROSS JOIN mv_questions mq
            CROSS JOIN feedback_stats fs;
          `,
          values: [
            startTimestamp,
            endTimestamp,
            new Date(startTimestamp),
            new Date(endTimestamp),
          ],
        };

        const result = await pool.query(mvQuery);
        if (result.rows.length > 0) {
          stats = result.rows[0];
          querySource = 'mv';
        }
      } catch (mvErr) {
        console.warn('[DashboardStats] MV query failed, falling back to base query:', mvErr.message);
      }
    }

    // Fallback: full base query
    if (!stats) {
      const queryParams = [];
      let paramIndex = 0;

      if (startTimestamp !== null) {
        paramIndex++;
        queryParams.push(startTimestamp);
      }

      if (endTimestamp !== null) {
        paramIndex++;
        queryParams.push(endTimestamp);
      }

      paramIndex++;
      queryParams.push(Date.now());

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
            WHERE feedbacktext IS NOT NULL
              AND (
                (questiontext IS NOT NULL AND fingerprint_id IS NOT NULL)
                OR COALESCE(feedback_source, 'chat') = 'voice'
              )
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
          startTimestamp,
          endTimestamp,
          new Date(startTimestamp),
          new Date(endTimestamp),
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

const parseCountMap = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const getLangfuseQuestionsTree = async (req, res) => {
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

    const params = [];
    let index = 0;
    let dateFilter = "";

    if (startTimestamp !== null) {
      index++;
      dateFilter += ` AND report_date >= (to_timestamp(($${index}::bigint) / 1000.0) AT TIME ZONE 'Asia/Kolkata')::date`;
      params.push(startTimestamp);
    }

    if (endTimestamp !== null) {
      index++;
      dateFilter += ` AND report_date <= (to_timestamp(($${index}::bigint) / 1000.0) AT TIME ZONE 'Asia/Kolkata')::date`;
      params.push(endTimestamp);
    }

    const [summaryResult, mappingResult] = await Promise.all([
      pool.query(
        `
          SELECT
            report_date,
            questions_total,
            questions_non_agri,
            questions_agri,
            tool_counts,
            category_counts
          FROM langfuse_daily_question_summary
          WHERE 1 = 1
          ${dateFilter}
          ORDER BY report_date DESC
        `,
        params
      ),
      pool.query(`
        SELECT
          tool_name,
          category_key
        FROM langfuse_tool_category_map
      `),
    ]);

    const categoryToTools = {};
    const toolToCategory = {};
    mappingResult.rows.forEach((row) => {
      const category = String(row.category_key || "uncategorized");
      const toolName = String(row.tool_name || "");
      if (!toolName) return;
      if (!categoryToTools[category]) {
        categoryToTools[category] = [];
      }
      categoryToTools[category].push(toolName);
      toolToCategory[toolName] = category;
    });

    const data = summaryResult.rows.map((row) => {
      const reportDate = row.report_date;
      const categoryCounts = parseCountMap(row.category_counts);
      const toolCounts = parseCountMap(row.tool_counts);

      const toolCountsByCategory = {};
      Object.entries(toolCounts).forEach(([toolName, rawCount]) => {
        const category = toolToCategory[toolName] || "uncategorized";
        if (!toolCountsByCategory[category]) {
          toolCountsByCategory[category] = [];
        }
        toolCountsByCategory[category].push({
          toolName,
          count: Number(rawCount) || 0,
        });
      });

      Object.values(toolCountsByCategory).forEach((tools) => {
        tools.sort((a, b) => b.count - a.count);
      });

      const allCategoryKeys = new Set([
        ...Object.keys(categoryCounts),
        ...Object.keys(toolCountsByCategory),
      ]);

      const agriCategories = [];
      const nonAgriCategories = [];

      allCategoryKeys.forEach((categoryKey) => {
        const normalized = String(categoryKey || "uncategorized");
        const countFromCategoryMap = Number(categoryCounts[normalized]) || 0;
        const tools = toolCountsByCategory[normalized] || [];
        const toolSum = tools.reduce((sum, item) => sum + item.count, 0);
        const count = countFromCategoryMap || toolSum;

        const node = {
          categoryKey: normalized,
          count,
          tools,
        };

        if (normalized === "uncategorized") {
          nonAgriCategories.push(node);
        } else {
          agriCategories.push(node);
        }
      });

      agriCategories.sort((a, b) => b.count - a.count);
      nonAgriCategories.sort((a, b) => b.count - a.count);

      return {
        reportDate,
        totalQuestions: Number(row.questions_total) || 0,
        questionsAgri: Number(row.questions_agri) || 0,
        questionsNonAgri: Number(row.questions_non_agri) || 0,
        agri: {
          categories: agriCategories,
        },
        nonAgri: {
          categories: nonAgriCategories,
        },
      };
    });

    return res.status(200).json({
      success: true,
      data,
      filters: {
        startDate,
        endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching langfuse questions tree:", error);
    return res.status(500).json({
      success: false,
      error: "Error fetching langfuse questions tree",
    });
  }
};

module.exports = {
  getUserLoginAnalytics,
  getDashboardStats,
  getUserGraph,
  getLangfuseQuestionsTree,
};
