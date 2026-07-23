const pool = require("../services/db");

const { parseDateRange } = require("../utils/dateUtils");
const { mvExists } = require("../utils/mvHealth");
const { buildChannelFilterClause } = require("../utils/stateAccess");
const {
  epochMsToIstDate,
  epochMsDateTruncIst,
  utcTimestampToIstTimestamp,
  utcTimestampToIstDate,
} = require("../utils/istSql");

// List of devices (one row per distinct fingerprint_id in the window).
// Uses questions + users join; this is cheap enough already. Keep it as-is.
async function fetchDevicesFromDB(
  page = 1,
  limit = 10,
  search = "",
  startDate = null,
  endDate = null,
  telemetryState = null,
) {
  const offset = (page - 1) * limit;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  const params = [];
  let idx = 0;
  const {
    clause: channelClause,
    paramIndex: channelParamIndex,
  } = buildChannelFilterClause("q.channel", telemetryState, params, idx);
  idx = channelParamIndex;

  let where = [
    `q.fingerprint_id IS NOT NULL`,
    `q.answertext IS NOT NULL`,
    channelClause,
  ];

  if (startTimestamp !== null) {
    idx++;
    where.push(`q.ets >= $${idx}`);
    params.push(startTimestamp);
  }
  if (endTimestamp !== null) {
    idx++;
    where.push(`q.ets <= $${idx}`);
    params.push(endTimestamp);
  }
  if (search && search.trim()) {
    idx++;
    where.push(`q.fingerprint_id ILIKE $${idx}`);
    params.push(`%${search.trim()}%`);
  }

  idx++;
  const limitParam = `$${idx}`;
  params.push(limit);
  idx++;
  const offsetParam = `$${idx}`;
  params.push(offset);

  const query = `
    WITH devices AS (
      SELECT
        q.fingerprint_id,
        MAX(q.ets) AS last_activity
      FROM questions q
      WHERE ${where.join(" AND ")}
      GROUP BY q.fingerprint_id
    )
    SELECT
      d.fingerprint_id,
      d.last_activity,
      u.browser_code, u.browser_name, u.browser_version,
      u.device_code, u.device_name, u.device_model,
      u.os_code, u.os_name, u.os_version,
      u.first_seen_at, u.last_seen_at
    FROM devices d
    LEFT JOIN users u ON u.fingerprint_id = d.fingerprint_id
    ORDER BY d.last_activity DESC
    LIMIT ${limitParam} OFFSET ${offsetParam};
  `;

  const result = await pool.query(query, params);
  return result.rows;
}

// Returns new/returning/total device counts for a date range.
// Prefer the IST-bucketed MVs so this is an O(days) scan, not O(users×questions).
async function getTotalAndNewDevicesCount(
  search = "",
  startDate = null,
  endDate = null,
  telemetryState = null,
) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  const params = [];
  let paramIndex = 0;
  const {
    clause: channelClause,
    paramIndex: channelParamIndex,
  } = buildChannelFilterClause("q.channel", telemetryState, params, paramIndex);
  paramIndex = channelParamIndex;

  const periodConditions = [];
  if (startTimestamp !== null) {
    paramIndex += 1;
    periodConditions.push(`q.ets >= $${paramIndex}`);
    params.push(startTimestamp);
  }
  if (endTimestamp !== null) {
    paramIndex += 1;
    periodConditions.push(`q.ets <= $${paramIndex}`);
    params.push(endTimestamp);
  }
  if (search && search.trim()) {
    paramIndex += 1;
    periodConditions.push(`q.fingerprint_id ILIKE $${paramIndex}`);
    params.push(`%${search.trim()}%`);
  }

  const periodFilter =
    periodConditions.length > 0 ? ` AND ${periodConditions.join(" AND ")}` : "";

  const [hasNewMV, hasReturningMV] = await Promise.all([
    mvExists('mv_users_daily_firstseen_ist'),
    mvExists('mv_users_daily_returning_ist'),
  ]);

  if (
    hasNewMV &&
    hasReturningMV &&
    startTimestamp !== null &&
    endTimestamp !== null &&
    !(search && search.trim())
  ) {
    try {
      const mvParams = [startTimestamp, endTimestamp];
      const { clause: mvChannelClause } = buildChannelFilterClause(
        "channel",
        telemetryState,
        mvParams,
        2,
      );
      const result = await pool.query(
        `
          WITH nu AS (
            SELECT COALESCE(SUM(new_users), 0) AS new_users
            FROM mv_users_daily_firstseen_ist
            WHERE bucket_date >= ${epochMsToIstDate("$1::bigint")}
              AND bucket_date <= ${epochMsToIstDate("$2::bigint")}
              AND ${mvChannelClause}
          ),
          ru AS (
            SELECT COALESCE(SUM(returning_users), 0) AS returning_users
            FROM mv_users_daily_returning_ist
            WHERE bucket_date >= ${epochMsToIstDate("$1::bigint")}
              AND bucket_date <= ${epochMsToIstDate("$2::bigint")}
              AND ${mvChannelClause}
          )
          SELECT
            nu.new_users AS new_users,
            ru.returning_users AS returning_users,
            (nu.new_users + ru.returning_users) AS total_users,
            'mv' AS source
          FROM nu CROSS JOIN ru;
        `,
        mvParams
      );
      const row = result.rows[0];
      return {
        newUsers: Number(row.new_users) || 0,
        returningUsers: Number(row.returning_users) || 0,
        totalUsers: Number(row.total_users) || 0,
        source: 'mv',
      };
    } catch (mvErr) {
      console.warn('[Devices] MV counts failed, falling back:', mvErr.message);
    }
  }

  // Fallback: legacy base query
  const query = `
    WITH first_seen AS (
      SELECT
        q.fingerprint_id,
        MIN(q.ets) AS first_seen_ets
      FROM questions q
      WHERE q.fingerprint_id IS NOT NULL
        AND q.answertext IS NOT NULL
        AND ${channelClause}
      GROUP BY q.fingerprint_id
    ),
    period_users AS (
      SELECT
        q.fingerprint_id,
        MIN(q.ets) AS period_first_seen_ets
      FROM questions q
      WHERE q.fingerprint_id IS NOT NULL
        AND q.answertext IS NOT NULL
        AND ${channelClause}
        ${periodFilter}
      GROUP BY q.fingerprint_id
    )
    SELECT
      COUNT(DISTINCT pu.fingerprint_id) AS total_users,
      COUNT(DISTINCT CASE
        WHEN fs.first_seen_ets = pu.period_first_seen_ets THEN pu.fingerprint_id
      END) AS new_users,
      COUNT(DISTINCT CASE
        WHEN fs.first_seen_ets < pu.period_first_seen_ets THEN pu.fingerprint_id
      END) AS returning_users
    FROM period_users pu
    INNER JOIN first_seen fs ON fs.fingerprint_id = pu.fingerprint_id;
  `;
  const result = await pool.query(query, params);
  const row = result.rows[0];
  return {
    newUsers: Number(row.new_users) || 0,
    returningUsers: Number(row.returning_users) || 0,
    totalUsers: Number(row.total_users) || 0,
    source: 'base',
  };
}

const getDevices = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
      return res.status(400).json({ success: false, error: "Invalid date format" });
    }
    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res.status(400).json({ success: false, error: "Start date cannot be after end date" });
    }

    const [devices, counts] = await Promise.all([
      fetchDevicesFromDB(page, limit, search, startDate, endDate, telemetryState),
      getTotalAndNewDevicesCount(search, startDate, endDate, telemetryState),
    ]);

    res.status(200).json({
      success: true,
      data: devices,
      stats: {
        totalUsers: counts.totalUsers,
        newUsers: counts.newUsers,
        returningUsers: counts.returningUsers,
      },
      pagination: {
        page,
        limit,
        total: counts.totalUsers,
        totalPages: Math.ceil(counts.totalUsers / limit),
      },
      meta: { countsSource: counts.source },
      filters: {
        search,
        startDate,
        endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching devices:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// GET /v1/devices/graph
// Previously did a heavy FULL OUTER JOIN of two per-request CTEs with
// IST-bucketed DATE_TRUNC and DISTINCT counts, taking ~3s on the Dashboard.
// Now we serve from mv_users_daily_firstseen_ist + mv_users_daily_returning_ist.
// Only "daily" granularity maps 1:1 to the MVs; hourly/weekly/monthly fall
// back to the legacy path.
const getDeviceGraph = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const granularity = req.query.granularity ? String(req.query.granularity).trim() : "daily";
    const search = req.query.search ? String(req.query.search).trim() : "";

    if (!["daily", "hourly", "weekly", "monthly"].includes(granularity)) {
      return res.status(400).json({
        success: false,
        error: "Invalid granularity. Must be 'daily', 'hourly', 'weekly', or 'monthly'",
      });
    }

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
      return res.status(400).json({ success: false, error: "Invalid date format." });
    }
    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res.status(400).json({ success: false, error: "Start date cannot be after end date" });
    }

    let graphData;
    let source = 'base';

    const baseParams = [];
    const {
      clause: channelClause,
      paramIndex: channelParamIndex,
    } = buildChannelFilterClause("q.channel", telemetryState, baseParams, 0);

    if (granularity === 'daily' && !(search && search.trim())) {
      const [hasNewMV, hasReturningMV] = await Promise.all([
        mvExists('mv_users_daily_firstseen_ist'),
        mvExists('mv_users_daily_returning_ist'),
      ]);
      if (hasNewMV && hasReturningMV) {
        try {
          const params = [];
          const conditions = [];
          if (startTimestamp !== null) {
            params.push(startTimestamp);
            conditions.push(`bucket_date >= ${epochMsToIstDate(`$${params.length}::bigint`)}`);
          }
          if (endTimestamp !== null) {
            params.push(endTimestamp);
            conditions.push(`bucket_date <= ${epochMsToIstDate(`$${params.length}::bigint`)}`);
          }
          const { clause: mvChannelClause } = buildChannelFilterClause(
            "channel",
            telemetryState,
            params,
            params.length,
          );
          conditions.push(mvChannelClause);
          const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

          const sql = `
            WITH n AS (
              SELECT bucket_date, SUM(new_users) AS new_users
              FROM mv_users_daily_firstseen_ist
              ${where}
              GROUP BY bucket_date
            ),
            r AS (
              SELECT bucket_date, SUM(returning_users) AS returning_users
              FROM mv_users_daily_returning_ist
              ${where}
              GROUP BY bucket_date
            ),
            merged AS (
              SELECT
                COALESCE(n.bucket_date, r.bucket_date) AS bucket_date,
                COALESCE(n.new_users, 0) AS new_users,
                COALESCE(r.returning_users, 0) AS returning_users
              FROM n
              FULL OUTER JOIN r ON n.bucket_date = r.bucket_date
            )
            SELECT
              TO_CHAR(bucket_date, 'YYYY-MM-DD') AS date,
              (new_users + returning_users) AS uniqueuserscount,
              new_users AS newuserscount,
              returning_users AS returninguserscount,
              EXTRACT(EPOCH FROM bucket_date::timestamp) * 1000 AS timestamp
            FROM merged
            ORDER BY bucket_date ASC;
          `;
          const mvResult = await pool.query(sql, params);
          graphData = mvResult.rows.map((row) => ({
            date: row.date,
            timestamp: parseInt(row.timestamp),
            uniqueUsersCount: parseInt(row.uniqueuserscount) || 0,
            newUsersCount: parseInt(row.newuserscount) || 0,
            returningUsersCount: parseInt(row.returninguserscount) || 0,
          }));
          source = 'mv';
        } catch (mvErr) {
          console.warn('[DeviceGraph] MV query failed, falling back:', mvErr.message);
        }
      }
    }

    if (!graphData) {
      // Legacy fallback: old heavy query with functional DATE_TRUNC.
      // Kept verbatim for correctness on hourly/weekly/monthly.
      let questionDateGrouping;
      let userDateGrouping;
      switch (granularity) {
        case "hourly":
          questionDateGrouping = epochMsDateTruncIst('hour', 'q.ets');
          userDateGrouping = `DATE_TRUNC('hour', ${utcTimestampToIstTimestamp('u.first_seen_at')})`;
          break;
        case "weekly":
          questionDateGrouping = epochMsDateTruncIst('week', 'q.ets');
          userDateGrouping = `DATE_TRUNC('week', ${utcTimestampToIstTimestamp('u.first_seen_at')})`;
          break;
        case "monthly":
          questionDateGrouping = epochMsDateTruncIst('month', 'q.ets');
          userDateGrouping = `DATE_TRUNC('month', ${utcTimestampToIstTimestamp('u.first_seen_at')})`;
          break;
        default:
          questionDateGrouping = epochMsDateTruncIst('day', 'q.ets');
          userDateGrouping = `DATE_TRUNC('day', ${utcTimestampToIstTimestamp('u.first_seen_at')})`;
      }

      const query = {
        text: `
          WITH
          new_users_by_bucket AS (
            SELECT
              ${userDateGrouping} AS bucket_date,
              COUNT(DISTINCT u.fingerprint_id) AS new_users
            FROM users u
            WHERE u.fingerprint_id IS NOT NULL
              ${channelClause === '1=1' ? '' : `AND EXISTS (
                SELECT 1 FROM questions q
                WHERE q.fingerprint_id = u.fingerprint_id
                  AND q.answertext IS NOT NULL
                  AND ${channelClause}
              )`}
              AND ${utcTimestampToIstDate('u.first_seen_at')} >= ${epochMsToIstDate(`$${baseParams.length + 1}::bigint`)}
              AND ${utcTimestampToIstDate('u.first_seen_at')} <= ${epochMsToIstDate(`$${baseParams.length + 2}::bigint`)}
            GROUP BY bucket_date
          ),
          returning_users_by_bucket AS (
            SELECT
              ${questionDateGrouping} AS bucket_date,
              COUNT(DISTINCT q.fingerprint_id) AS returning_users
            FROM questions q
            INNER JOIN users u ON q.fingerprint_id = u.fingerprint_id
            WHERE q.fingerprint_id IS NOT NULL
              AND ${channelClause}
              AND q.ets >= $${baseParams.length + 1}::bigint AND q.ets <= $${baseParams.length + 2}::bigint
              AND ${epochMsToIstDate('q.ets')} != ${utcTimestampToIstDate('u.first_seen_at')}
            GROUP BY bucket_date
          ),
          merged AS (
            SELECT
              COALESCE(n.bucket_date, r.bucket_date) AS bucket_date,
              COALESCE(n.new_users, 0) AS new_users,
              COALESCE(r.returning_users, 0) AS returning_users
            FROM new_users_by_bucket n
            FULL OUTER JOIN returning_users_by_bucket r ON n.bucket_date = r.bucket_date
          )
          SELECT
            TO_CHAR(bucket_date, 'YYYY-MM-DD') AS date,
            (new_users + returning_users) AS uniqueuserscount,
            new_users AS newuserscount,
            returning_users AS returninguserscount,
            EXTRACT(EPOCH FROM bucket_date) * 1000 AS timestamp
          FROM merged
          ORDER BY bucket_date ASC;
        `,
        values: [...baseParams, startTimestamp ?? null, endTimestamp ?? null],
      };

      const result = await pool.query(query);
      graphData = result.rows.map((row) => ({
        date: row.date,
        timestamp: parseInt(row.timestamp),
        uniqueUsersCount: parseInt(row.uniqueuserscount) || 0,
        newUsersCount: parseInt(row.newuserscount) || 0,
        returningUsersCount: parseInt(row.returninguserscount) || 0,
      }));
    }

    const totalUniqueUsers = Math.max(
      ...graphData.map((item) => item.uniqueUsersCount),
      0
    );
    const peakPeriod = graphData.reduce(
      (max, item) => (item.uniqueUsersCount > max.uniqueUsersCount ? item : max),
      { uniqueUsersCount: 0, date: null }
    );

    res.status(200).json({
      success: true,
      data: graphData,
      metadata: {
        granularity,
        totalDataPoints: graphData.length,
        dateRange: {
          start: graphData.length > 0 ? graphData[0].date : null,
          end:   graphData.length > 0 ? graphData[graphData.length - 1].date : null,
        },
        summary: {
          totalUniqueUsers,
          peakActivity: { date: peakPeriod.date, uniqueUsersCount: peakPeriod.uniqueUsersCount },
        },
      },
      meta: { source },
      filters: {
        search,
        startDate,
        endDate,
        granularity,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching devices graph data:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

module.exports = {
  getDevices,
  getDeviceGraph,
  fetchDevicesFromDB,
};
