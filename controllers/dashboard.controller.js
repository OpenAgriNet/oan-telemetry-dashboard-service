const pool = require("../services/db");
const { parseDateRange } = require("../utils/dateUtils");
const { mvExists } = require("../utils/mvHealth");
const { buildChannelFilterClause } = require("../utils/stateAccess");
const {
  epochMsToIstDate,
  epochMsToIstTimestamp,
  utcTimestampToIstDate,
} = require("../utils/istSql");

/**
 * GET /dashboard/user-analytics?granularity=daily|hourly
 * Returns user login analytics for dashboard.
 * - daily  -> mv_active_users (existing)
 * - hourly -> mv_hourly_active_users (new); falls back to live UNION ALL query
 */
const getUserLoginAnalytics = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
    const granularity = req.query.granularity === "hourly" ? "hourly" : "daily";
    const mvStateClause = buildChannelFilterClause("channel", telemetryState, [], 0).clause;

    if (granularity === "daily") {
      // Try MV-first approach
      const hasMV = await mvExists('mv_active_users');
      if (hasMV && mvStateClause === "1=1") {
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
                uids: [],
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
      const baseParams = [];
      const {
        clause: questionsChannelClause,
        paramIndex: questionsChannelParamIndex,
      } = buildChannelFilterClause("q.channel", telemetryState, baseParams, 0);
      const {
        clause: errorsChannelClause,
      } = buildChannelFilterClause("e.channel", telemetryState, baseParams, questionsChannelParamIndex);

      const result = await pool.query(
        `
        SELECT
          to_char(${epochMsToIstDate("ets")}, 'YYYY-MM-DD') as date,
          COUNT(DISTINCT uid) as unique_logins,
          array_agg(DISTINCT uid) as uids
        FROM (
          SELECT q.uid, q.ets FROM questions q WHERE q.uid IS NOT NULL AND ${questionsChannelClause}
          UNION ALL
          SELECT e.uid, e.ets FROM errordetails e WHERE e.uid IS NOT NULL AND ${errorsChannelClause}
        ) AS combined
        WHERE ${epochMsToIstDate("ets")} >= (timezone('Asia/Kolkata', now()))::date - INTERVAL '7 days'
        GROUP BY date
        ORDER BY date DESC
      `,
        baseParams
      );

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
      // Hourly branch -- try mv_hourly_active_users first
      const hasHourlyMV = await mvExists('mv_hourly_active_users');
      if (hasHourlyMV && mvStateClause === "1=1") {
        try {
          const result = await pool.query(`
            SELECT hour_bucket_ist AS hour, active_users AS unique_logins
            FROM mv_hourly_active_users
            WHERE hour_bucket_ist >= date_trunc('hour', timezone('Asia/Kolkata', now())) - INTERVAL '11 hours'
            ORDER BY hour_bucket_ist DESC
          `);

          const now = new Date();
          const hours = [];
          for (let i = 11; i >= 0; i--) {
            const h = new Date(now);
            h.setHours(now.getHours() - i, 0, 0, 0);
            hours.push(h.toISOString().slice(0, 13) + ":00");
          }
          const dataMap = {};
          result.rows.forEach((row) => {
            const hour = new Date(row.hour).toISOString().slice(0, 13) + ":00";
            dataMap[hour] = parseInt(row.unique_logins, 10);
          });
          const data = hours.map((hour) => ({
            hour,
            uniqueLogins: dataMap[hour] || 0,
          }));

          return res.json({ success: true, granularity: 'hourly', data, source: 'mv' });
        } catch (mvErr) {
          console.warn('[UserLoginAnalytics] Hourly MV query failed, falling back:', mvErr.message);
        }
      }

      // Fallback: live UNION ALL
      const baseParams = [];
      const {
        clause: questionsChannelClause,
        paramIndex: questionsChannelParamIndex,
      } = buildChannelFilterClause("q.channel", telemetryState, baseParams, 0);
      const {
        clause: errorsChannelClause,
      } = buildChannelFilterClause("e.channel", telemetryState, baseParams, questionsChannelParamIndex);

      const result = await pool.query(`
        WITH combined AS (
          SELECT q.uid, q.ets FROM questions q WHERE q.uid IS NOT NULL AND ${questionsChannelClause}
          UNION ALL
          SELECT e.uid, e.ets FROM errordetails e WHERE e.uid IS NOT NULL AND ${errorsChannelClause}
        ),
        logins AS (
          SELECT
            date_trunc('hour', ${epochMsToIstTimestamp("ets")}) AS hour,
            uid
          FROM combined
          WHERE ${epochMsToIstTimestamp("ets")} >= date_trunc('hour', timezone('Asia/Kolkata', now())) - INTERVAL '11 hours'
        )
        SELECT
          hour,
          COUNT(DISTINCT uid) AS unique_logins
        FROM logins
        GROUP BY hour
        ORDER BY hour DESC
      `, baseParams);

      const now = new Date();
      const hours = [];
      for (let i = 11; i >= 0; i--) {
        const h = new Date(now);
        h.setHours(now.getHours() - i, 0, 0, 0);
        hours.push(h.toISOString().slice(0, 13) + ":00");
      }
      const dataMap = {};
      result.rows.forEach((row) => {
        const hour = new Date(row.hour).toISOString().slice(0, 13) + ":00";
        dataMap[hour] = parseInt(row.unique_logins, 10);
      });
      const data = hours.map((hour) => ({
        hour,
        uniqueLogins: dataMap[hour] || 0,
      }));

      return res.json({ success: true, granularity: "hourly", data, source: 'base' });
    }
  } catch (error) {
    console.error("Error in getUserLoginAnalytics:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// GET /dashboard/stats — MV-first dashboard aggregates.
// All four sub-totals (new, returning, sessions, questions) are now served
// from materialized views. Feedback uses mv_feedback_daily when available.
const getDashboardStats = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate   = req.query.endDate   ? String(req.query.endDate).trim()   : null;

    // True only when the time portion is genuinely intra-day (not a midnight
    // or end-of-day boundary). Day-boundary timestamps like T00:00:00... or
    // T23:59:59... work correctly with day-granularity materialized views and
    // should NOT block the MV fast path.
    const isIntraDayTime = (dateStr) => {
      if (!dateStr || !dateStr.includes("T")) return false;
      const timePart = (dateStr.split("T")[1] || "").substring(0, 8);
      return timePart !== "00:00:00" && timePart !== "23:59:59";
    };
    const hasTimeComponent = isIntraDayTime(startDate) || isIntraDayTime(endDate);

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

    if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
      return res.status(400).json({ success: false, error: "Invalid date format" });
    }

    // Discover which MVs are available.
    const [
      hasSessionMV,
      hasQuestionRateMV,
      hasNewUsersMV,
      hasReturningUsersMV,
      hasFeedbackDailyMV,
    ] = await Promise.all([
      mvExists('mv_sessions_daily'),
      mvExists('mv_question_answer_rates'),
      mvExists('mv_users_daily_firstseen_ist'),
      mvExists('mv_users_daily_returning_ist'),
      mvExists('mv_feedback_daily'),
    ]);

    const mvStateClause = buildChannelFilterClause("channel", telemetryState, [], 0).clause;

    const canUseMvPath =
      hasSessionMV && hasQuestionRateMV && hasNewUsersMV && hasReturningUsersMV;

    let stats;
    let querySource = 'base';
    const sources = {};

    if (canUseMvPath && mvStateClause === "1=1" && !hasTimeComponent) {
      try {
        // Pure MV path. Feedback CTE picks MV when available, otherwise
        // falls back to a bounded base-table scan for the date range.
        const feedbackCte = hasFeedbackDailyMV
          ? `SELECT
               COALESCE(SUM(total_feedback), 0) AS total_feedback,
               COALESCE(SUM(likes), 0) AS total_likes,
               COALESCE(SUM(dislikes), 0) AS total_dislikes
             FROM mv_feedback_daily
             WHERE feedback_date >= ${epochMsToIstDate("$1::bigint")}
               AND feedback_date <= ${epochMsToIstDate("$2::bigint")}`
          : `SELECT
               COUNT(*) AS total_feedback,
               COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) AS total_likes,
               COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) AS total_dislikes
             FROM feedback
             WHERE feedbacktext IS NOT NULL
               AND ((questiontext IS NOT NULL AND fingerprint_id IS NOT NULL)
                    OR COALESCE(feedback_source, 'chat') = 'voice')
               AND ets >= $1 AND ets <= $2`;

        const mvQuery = {
          text: `
            WITH user_stats AS (
              SELECT
                ( SELECT COALESCE(SUM(new_users), 0)
                  FROM mv_users_daily_firstseen_ist
                  WHERE bucket_date >= ${epochMsToIstDate("$1::bigint")}
                    AND bucket_date <= ${epochMsToIstDate("$2::bigint")}
                ) AS new_users,
                ( SELECT COALESCE(SUM(returning_users), 0)
                  FROM mv_users_daily_returning_ist
                  WHERE bucket_date >= ${epochMsToIstDate("$1::bigint")}
                    AND bucket_date <= ${epochMsToIstDate("$2::bigint")}
                ) AS returning_users
            ),
            mv_sessions AS (
              SELECT COALESCE(COUNT(*), 0) AS total_sessions
              FROM mv_sessions_daily
              WHERE session_date_ist >= ${epochMsToIstDate("$1::bigint")}
                AND session_date_ist <= ${epochMsToIstDate("$2::bigint")}
            ),
            mv_questions AS (
              SELECT COALESCE(SUM(total_questions), 0) AS total_questions
              FROM mv_question_answer_rates
              WHERE question_date >= ${epochMsToIstDate("$1::bigint")}
                AND question_date <= ${epochMsToIstDate("$2::bigint")}
            ),
            feedback_stats AS (
              ${feedbackCte}
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
          ],
        };

        const result = await pool.query(mvQuery);
        if (result.rows.length > 0) {
          stats = result.rows[0];
          querySource = 'mv';
          sources.users = 'mv';
          sources.sessions = 'mv';
          sources.questions = 'mv';
          sources.feedback = hasFeedbackDailyMV ? 'mv' : 'base';
        }
      } catch (mvErr) {
        console.warn('[DashboardStats] MV query failed, falling back to base query:', mvErr.message);
      }
    }

    // Fallback: legacy full base query (kept verbatim for correctness when
    // any required MV is missing or the MV query errors).
    if (!stats) {
      const queryParams = [startTimestamp, endTimestamp];
      const {
        clause: questionsChannelClause,
        paramIndex: questionsChannelParamIndex,
      } = buildChannelFilterClause("q.channel", telemetryState, queryParams, 2);
      let nextParamIndex = questionsChannelParamIndex;

      let questionStatsCte = `
          SELECT COUNT(*) AS total_questions
          FROM filtered_questions
        `;
      if (hasQuestionRateMV && !hasTimeComponent) {
        const { clause: mvQuestionChannelClause, paramIndex } = buildChannelFilterClause(
          "channel",
          telemetryState,
          queryParams,
          nextParamIndex,
        );
        nextParamIndex = paramIndex;
        questionStatsCte = `
          SELECT COALESCE(SUM(total_questions), 0) AS total_questions
          FROM mv_question_answer_rates
          WHERE question_date >= ${epochMsToIstDate("$1::bigint")}
            AND question_date <= ${epochMsToIstDate("$2::bigint")}
            AND ${mvQuestionChannelClause}
        `;
      }

      let feedbackStatsCte = `
          SELECT
            COUNT(*) AS total_feedback,
            COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) AS total_likes,
            COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) AS total_dislikes
          FROM feedback f
          WHERE f.feedbacktext IS NOT NULL
            AND ((f.questiontext IS NOT NULL AND f.fingerprint_id IS NOT NULL)
                 OR COALESCE(f.feedback_source, 'chat') = 'voice')
            AND f.ets >= $1 AND f.ets <= $2
            AND 1=1
        `;
      if (hasFeedbackDailyMV && !hasTimeComponent) {
        const { clause: mvFeedbackChannelClause, paramIndex } = buildChannelFilterClause(
          "channel",
          telemetryState,
          queryParams,
          nextParamIndex,
        );
        nextParamIndex = paramIndex;
        feedbackStatsCte = `
          SELECT
            COALESCE(SUM(total_feedback), 0) AS total_feedback,
            COALESCE(SUM(likes), 0) AS total_likes,
            COALESCE(SUM(dislikes), 0) AS total_dislikes
          FROM mv_feedback_daily
          WHERE feedback_date >= ${epochMsToIstDate("$1::bigint")}
            AND feedback_date <= ${epochMsToIstDate("$2::bigint")}
            AND ${mvFeedbackChannelClause}
        `;
      } else {
        const { clause: feedbackChannelClause } = buildChannelFilterClause(
          "f.channel",
          telemetryState,
          queryParams,
          nextParamIndex,
        );
        feedbackStatsCte = feedbackStatsCte.replace("AND 1=1", `AND ${feedbackChannelClause}`);
      }

      const query = {
        text: `
          WITH filtered_questions AS (
            SELECT q.fingerprint_id, q.sid, q.ets
            FROM questions q
            WHERE q.answertext IS NOT NULL
              AND q.fingerprint_id IS NOT NULL
              AND q.ets >= $1 AND q.ets <= $2
              AND ${questionsChannelClause}
          ),
          user_stats AS (
            SELECT
              COUNT(DISTINCT fq.fingerprint_id) FILTER (
                WHERE ${utcTimestampToIstDate("u.first_seen_at")} >= ${epochMsToIstDate("$1::bigint")}
                  AND ${utcTimestampToIstDate("u.first_seen_at")} <= ${epochMsToIstDate("$2::bigint")}
              ) AS new_users,
              COUNT(DISTINCT fq.fingerprint_id) FILTER (
                WHERE ${epochMsToIstDate("fq.ets")} != ${utcTimestampToIstDate("u.first_seen_at")}
              ) AS returning_users
            FROM filtered_questions fq
            INNER JOIN users u ON fq.fingerprint_id = u.fingerprint_id
          ),
          session_stats AS (
            SELECT COUNT(DISTINCT (fq.sid, fq.fingerprint_id)) AS total_sessions
            FROM filtered_questions fq
            WHERE fq.sid IS NOT NULL AND fq.fingerprint_id IS NOT NULL
          ),
          question_stats AS (
            ${questionStatsCte}
          ),
          feedback_stats AS (
            ${feedbackStatsCte}
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
        values: queryParams,
        query_timeout: 45000,
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
        sources,
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
    res.status(500).json({ success: false, error: "Error fetching dashboard statistics" });
  }
};

const getAppDownloads = async (req, res) => {
  try {
    if (req.telemetryState?.id !== "bharat-vistaar") {
      return res.status(403).json({
        success: false,
        error: "App downloads are only available for Bharat Vistaar",
      });
    }

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

    const result = await pool.query(
      `
        SELECT
          TO_CHAR(date, 'YYYY-MM-DD') AS date,
          platform,
          version,
          installs
        FROM public.app_download_daily_metrics
        WHERE ($1::bigint IS NULL OR date >= DATE(TO_TIMESTAMP($1 / 1000.0) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))
          AND ($2::bigint IS NULL OR date <= DATE(TO_TIMESTAMP($2 / 1000.0) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))
        ORDER BY date DESC, platform ASC, version ASC
      `,
      [startTimestamp, endTimestamp],
    );

    return res.status(200).json({
      success: true,
      data: result.rows.map((row) => ({
        date: row.date,
        platform: row.platform,
        version: row.version,
        installs: Number(row.installs) || 0,
      })),
      filters: {
        startDate,
        endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching app downloads:", error);
    return res
      .status(500)
      .json({ success: false, error: "Error fetching app downloads" });
  }
};

// Legacy stub kept for backwards compatibility with /dashboard/user-graph.
const getUserGraph = async (req, res) => {
  try {
    res.status(200).json({ success: true, data: "test" });
  } catch (error) {
    console.error("Error fetching user graph:", error);
    res.status(500).json({ success: false, error: "Error fetching user graph" });
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
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate   = req.query.endDate   ? String(req.query.endDate).trim()   : null;

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

    if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
      return res.status(400).json({ success: false, error: "Invalid date format" });
    }

    const params = [];
    let index = 0;
    let dateFilter = "";

    if (startTimestamp !== null) {
      index++;
      dateFilter += ` AND report_date >= ${epochMsToIstDate(`$${index}::bigint`)}`;
      params.push(startTimestamp);
    }
    if (endTimestamp !== null) {
      index++;
      dateFilter += ` AND report_date <= ${epochMsToIstDate(`$${index}::bigint`)}`;
      params.push(endTimestamp);
    }

    const [summaryResult, mappingResult] = await Promise.all([
      pool.query(
        `
          SELECT report_date, questions_total, questions_non_agri, questions_agri, tool_counts, category_counts
          FROM langfuse_daily_question_summary
          WHERE 1 = 1
          ${dateFilter}
          ORDER BY report_date DESC
        `,
        params
      ),
      pool.query(`SELECT tool_name, category_key FROM langfuse_tool_category_map`),
    ]);

    const categoryToTools = {};
    const toolToCategory = {};
    mappingResult.rows.forEach((row) => {
      const category = String(row.category_key || "uncategorized");
      const toolName = String(row.tool_name || "");
      if (!toolName) return;
      if (!categoryToTools[category]) categoryToTools[category] = [];
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
        if (!toolCountsByCategory[category]) toolCountsByCategory[category] = [];
        toolCountsByCategory[category].push({ toolName, count: Number(rawCount) || 0 });
      });
      Object.values(toolCountsByCategory).forEach((tools) => tools.sort((a, b) => b.count - a.count));

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
        const node = { categoryKey: normalized, count, tools };
        if (normalized === "uncategorized") nonAgriCategories.push(node);
        else agriCategories.push(node);
      });
      agriCategories.sort((a, b) => b.count - a.count);
      nonAgriCategories.sort((a, b) => b.count - a.count);

      return {
        reportDate,
        totalQuestions: Number(row.questions_total) || 0,
        questionsAgri: Number(row.questions_agri) || 0,
        questionsNonAgri: Number(row.questions_non_agri) || 0,
        agri: { categories: agriCategories },
        nonAgri: { categories: nonAgriCategories },
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
    return res.status(500).json({ success: false, error: "Error fetching langfuse questions tree" });
  }
};

// Get overall dashboard statistics for UNIFIED METRICS (always Bharat Vistaar)
// Get overall dashboard statistics for UNIFIED METRICS (always Bharat Vistaar)
const getDashboardStatsUnified = async (req, res) => {
  try {
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    // True only when the time portion is genuinely intra-day (not a midnight
    // or end-of-day boundary). Day-boundary timestamps like T00:00:00... or
    // T23:59:59... work correctly with day-granularity materialized views and
    // should NOT block the MV fast path.
    const isIntraDayTime = (dateStr) => {
      if (!dateStr || !dateStr.includes("T")) return false;
      const timePart = (dateStr.split("T")[1] || "").substring(0, 8);
      return timePart !== "00:00:00" && timePart !== "23:59:59";
    };
    const hasTimeComponent = isIntraDayTime(startDate) || isIntraDayTime(endDate);

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

    if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
      return res.status(400).json({ success: false, error: "Invalid date format" });
    }

    // Force Bharat Vistaar channel filters for unified metrics.
    // buildChannelFilterClause expects exactChannels/prefixChannels.
    const unifiedTelemetryState = {
      exactChannels: ["BharatVistaar"],
      prefixChannels: ["BharatVistaar-"],
    };
    const mvStateClause = buildChannelFilterClause("channel", unifiedTelemetryState, [], 0).clause;

    // Discover which MVs are available
    const [
      hasSessionMV,
      hasQuestionRateMV,
      hasNewUsersMV,
      hasReturningUsersMV,
      hasFeedbackDailyMV,
    ] = await Promise.all([
      mvExists('mv_sessions_daily'),
      mvExists('mv_question_answer_rates'),
      mvExists('mv_users_daily_firstseen_ist'),
      mvExists('mv_users_daily_returning_ist'),
      mvExists('mv_feedback_daily'),
    ]);

    const canUseMvPath =
      hasSessionMV && hasQuestionRateMV && hasNewUsersMV && hasReturningUsersMV;

    let stats;
    let querySource = 'base';
    const sources = {};

    if (canUseMvPath && mvStateClause === "1=1" && !hasTimeComponent) {
      try {
        // Pure MV path for Bharat Vistaar
        const feedbackCte = hasFeedbackDailyMV
          ? `SELECT
               COALESCE(SUM(total_feedback), 0) AS total_feedback,
               COALESCE(SUM(likes), 0) AS total_likes,
               COALESCE(SUM(dislikes), 0) AS total_dislikes
             FROM mv_feedback_daily
             WHERE feedback_date >= ${epochMsToIstDate("$1::bigint")}
               AND feedback_date <= ${epochMsToIstDate("$2::bigint")}`
          : `SELECT
               COUNT(*) AS total_feedback,
               COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) AS total_likes,
               COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) AS total_dislikes
             FROM feedback
             WHERE feedbacktext IS NOT NULL
               AND ((questiontext IS NOT NULL AND fingerprint_id IS NOT NULL)
                    OR COALESCE(feedback_source, 'chat') = 'voice')
               AND ets >= $1 AND ets <= $2
               AND channel = 'bharat-vistaar'`;

        const mvQuery = {
          text: `
            WITH user_stats AS (
              SELECT
                ( SELECT COALESCE(SUM(new_users), 0)
                  FROM mv_users_daily_firstseen_ist
                  WHERE bucket_date >= ${epochMsToIstDate("$1::bigint")}
                    AND bucket_date <= ${epochMsToIstDate("$2::bigint")}
                ) AS new_users,
                ( SELECT COALESCE(SUM(returning_users), 0)
                  FROM mv_users_daily_returning_ist
                  WHERE bucket_date >= ${epochMsToIstDate("$1::bigint")}
                    AND bucket_date <= ${epochMsToIstDate("$2::bigint")}
                ) AS returning_users
            ),
            mv_sessions AS (
              SELECT COALESCE(COUNT(*), 0) AS total_sessions
              FROM mv_sessions_daily
              WHERE session_date_ist >= ${epochMsToIstDate("$1::bigint")}
                AND session_date_ist <= ${epochMsToIstDate("$2::bigint")}
            ),
            mv_questions AS (
              SELECT COALESCE(SUM(total_questions), 0) AS total_questions
              FROM mv_question_answer_rates
              WHERE question_date >= ${epochMsToIstDate("$1::bigint")}
                AND question_date <= ${epochMsToIstDate("$2::bigint")}
            ),
            feedback_stats AS (
              ${feedbackCte}
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
          ],
        };

        const result = await pool.query(mvQuery);
        if (result.rows.length > 0) {
          stats = result.rows[0];
          querySource = 'mv';
          sources.users = 'mv';
          sources.sessions = 'mv';
          sources.questions = 'mv';
          sources.feedback = hasFeedbackDailyMV ? 'mv' : 'base';
        }
      } catch (mvErr) {
        console.warn('[DashboardStatsUnified] MV query failed, falling back to base query:', mvErr.message);
      }
    }

    // Fallback: legacy base query for Bharat Vistaar
    if (!stats) {
      const queryParams = [startTimestamp, endTimestamp];
      const {
        clause: questionsChannelClause,
        paramIndex: questionsChannelParamIndex,
      } = buildChannelFilterClause("q.channel", unifiedTelemetryState, queryParams, 2);
      let nextParamIndex = questionsChannelParamIndex;

      let questionStatsCte = `
          SELECT COUNT(*) AS total_questions
          FROM filtered_questions
        `;
      if (hasQuestionRateMV && !hasTimeComponent) {
        const { clause: mvQuestionChannelClause, paramIndex } = buildChannelFilterClause(
          "channel",
          unifiedTelemetryState,
          queryParams,
          nextParamIndex,
        );
        nextParamIndex = paramIndex;
        questionStatsCte = `
          SELECT COALESCE(SUM(total_questions), 0) AS total_questions
          FROM mv_question_answer_rates
          WHERE question_date >= ${epochMsToIstDate("$1::bigint")}
            AND question_date <= ${epochMsToIstDate("$2::bigint")}
            AND ${mvQuestionChannelClause}
        `;
      }

      let feedbackStatsCte = `
          SELECT
            COUNT(*) AS total_feedback,
            COUNT(CASE WHEN feedbacktype = 'like' THEN 1 END) AS total_likes,
            COUNT(CASE WHEN feedbacktype = 'dislike' THEN 1 END) AS total_dislikes
          FROM feedback f
          WHERE f.feedbacktext IS NOT NULL
            AND ((f.questiontext IS NOT NULL AND f.fingerprint_id IS NOT NULL)
                 OR COALESCE(f.feedback_source, 'chat') = 'voice')
            AND f.ets >= $1 AND f.ets <= $2
            AND 1=1
        `;
      if (hasFeedbackDailyMV && !hasTimeComponent) {
        const { clause: mvFeedbackChannelClause, paramIndex } = buildChannelFilterClause(
          "channel",
          unifiedTelemetryState,
          queryParams,
          nextParamIndex,
        );
        nextParamIndex = paramIndex;
        feedbackStatsCte = `
          SELECT
            COALESCE(SUM(total_feedback), 0) AS total_feedback,
            COALESCE(SUM(likes), 0) AS total_likes,
            COALESCE(SUM(dislikes), 0) AS total_dislikes
          FROM mv_feedback_daily
          WHERE feedback_date >= ${epochMsToIstDate("$1::bigint")}
            AND feedback_date <= ${epochMsToIstDate("$2::bigint")}
            AND ${mvFeedbackChannelClause}
        `;
      } else {
        const { clause: feedbackChannelClause } = buildChannelFilterClause(
          "f.channel",
          unifiedTelemetryState,
          queryParams,
          nextParamIndex,
        );
        feedbackStatsCte = feedbackStatsCte.replace("AND 1=1", `AND ${feedbackChannelClause}`);
      }

      const query = {
        text: `
          WITH filtered_questions AS (
            SELECT q.fingerprint_id, q.sid, q.ets
            FROM questions q
            WHERE q.answertext IS NOT NULL
              AND q.fingerprint_id IS NOT NULL
              AND q.ets >= $1 AND q.ets <= $2
              AND ${questionsChannelClause}
          ),
          user_stats AS (
            SELECT
              COUNT(DISTINCT fq.fingerprint_id) FILTER (
                WHERE ${utcTimestampToIstDate("u.first_seen_at")} >= ${epochMsToIstDate("$1::bigint")}
                  AND ${utcTimestampToIstDate("u.first_seen_at")} <= ${epochMsToIstDate("$2::bigint")}
              ) AS new_users,
              COUNT(DISTINCT fq.fingerprint_id) FILTER (
                WHERE ${epochMsToIstDate("fq.ets")} != ${utcTimestampToIstDate("u.first_seen_at")}
              ) AS returning_users
            FROM filtered_questions fq
            INNER JOIN users u ON fq.fingerprint_id = u.fingerprint_id
          ),
          session_stats AS (
            SELECT COUNT(DISTINCT (fq.sid, fq.fingerprint_id)) AS total_sessions
            FROM filtered_questions fq
            WHERE fq.sid IS NOT NULL AND fq.fingerprint_id IS NOT NULL
          ),
          question_stats AS (
            ${questionStatsCte}
          ),
          feedback_stats AS (
            ${feedbackStatsCte}
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
        values: queryParams,
        query_timeout: 45000,
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
        sources,
        appliedState: 'bharat-vistaar',
      },
      filters: {
        startDate,
        endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching unified dashboard stats:", error);
    res.status(500).json({ success: false, error: "Error fetching unified dashboard statistics" });
  }
};

module.exports = {
  getUserLoginAnalytics,
  getDashboardStats,
  getAppDownloads,
  getDashboardStatsUnified,
  getUserGraph,
  getLangfuseQuestionsTree,
};
