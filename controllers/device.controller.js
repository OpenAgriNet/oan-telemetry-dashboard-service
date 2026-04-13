const pool = require("../services/db");
const { parseDateRange } = require("../utils/dateUtils");
const { buildChannelFilterClause } = require("../utils/stateAccess");

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
  let paramIndex = 0;
  const {
    clause: channelClause,
    paramIndex: channelParamIndex,
  } = buildChannelFilterClause("q.channel", telemetryState, params, paramIndex);
  paramIndex = channelParamIndex;

  const where = ["q.fingerprint_id IS NOT NULL", "q.answertext IS NOT NULL", channelClause];

  if (startTimestamp !== null) {
    paramIndex += 1;
    where.push(`q.ets >= $${paramIndex}`);
    params.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex += 1;
    where.push(`q.ets <= $${paramIndex}`);
    params.push(endTimestamp);
  }

  if (search && search.trim()) {
    paramIndex += 1;
    where.push(`q.fingerprint_id ILIKE $${paramIndex}`);
    params.push(`%${search.trim()}%`);
  }

  paramIndex += 1;
  const limitParam = `$${paramIndex}`;
  params.push(limit);

  paramIndex += 1;
  const offsetParam = `$${paramIndex}`;
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
      u.browser_code,
      u.browser_name,
      u.browser_version,
      u.device_code,
      u.device_name,
      u.device_model,
      u.os_code,
      u.os_name,
      u.os_version,
      u.first_seen_at,
      u.last_seen_at
    FROM devices d
    LEFT JOIN users u ON u.fingerprint_id = d.fingerprint_id
    ORDER BY d.last_activity DESC
    LIMIT ${limitParam} OFFSET ${offsetParam};
  `;

  const result = await pool.query(query, params);
  return result.rows;
}

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
  const row = result.rows[0] || {};
  return {
    newUsers: Number(row.new_users) || 0,
    returningUsers: Number(row.returning_users) || 0,
    totalUsers: Number(row.total_users) || 0,
  };
}

const getDevices = async (req, res) => {
  try {
    const telemetryState = req.telemetryState;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format",
      });
    }

    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res.status(400).json({
        success: false,
        error: "Start date cannot be after end date",
      });
    }

    const [devices, counts] = await Promise.all([
      fetchDevicesFromDB(page, limit, search, startDate, endDate, telemetryState),
      getTotalAndNewDevicesCount(search, startDate, endDate, telemetryState),
    ]);

    return res.status(200).json({
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
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

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
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }

    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res.status(400).json({
        success: false,
        error: "Start date cannot be after end date",
      });
    }

    const queryParams = [];
    let paramIndex = 0;
    const {
      clause: channelClause,
      paramIndex: channelParamIndex,
    } = buildChannelFilterClause("q.channel", telemetryState, queryParams, paramIndex);
    paramIndex = channelParamIndex;

    const periodConditions = [];
    if (startTimestamp !== null) {
      paramIndex += 1;
      periodConditions.push(`q.ets >= $${paramIndex}`);
      queryParams.push(startTimestamp);
    }
    if (endTimestamp !== null) {
      paramIndex += 1;
      periodConditions.push(`q.ets <= $${paramIndex}`);
      queryParams.push(endTimestamp);
    }
    if (search && search.trim()) {
      paramIndex += 1;
      periodConditions.push(`q.fingerprint_id ILIKE $${paramIndex}`);
      queryParams.push(`%${search.trim()}%`);
    }

    const periodFilter =
      periodConditions.length > 0 ? ` AND ${periodConditions.join(" AND ")}` : "";

    let bucketExpr;
    let dateLabelExpr;
    switch (granularity) {
      case "hourly":
        bucketExpr = "DATE_TRUNC('hour', TO_TIMESTAMP(q.ets / 1000) AT TIME ZONE 'Asia/Kolkata')";
        dateLabelExpr = "TO_CHAR(pu.bucket_date, 'YYYY-MM-DD HH24:00')";
        break;
      case "weekly":
        bucketExpr = "DATE_TRUNC('week', TO_TIMESTAMP(q.ets / 1000) AT TIME ZONE 'Asia/Kolkata')";
        dateLabelExpr = "TO_CHAR(pu.bucket_date, 'YYYY-MM-DD')";
        break;
      case "monthly":
        bucketExpr = "DATE_TRUNC('month', TO_TIMESTAMP(q.ets / 1000) AT TIME ZONE 'Asia/Kolkata')";
        dateLabelExpr = "TO_CHAR(pu.bucket_date, 'YYYY-MM')";
        break;
      case "daily":
      default:
        bucketExpr = "DATE_TRUNC('day', TO_TIMESTAMP(q.ets / 1000) AT TIME ZONE 'Asia/Kolkata')";
        dateLabelExpr = "TO_CHAR(pu.bucket_date, 'YYYY-MM-DD')";
        break;
    }

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
        SELECT DISTINCT
          ${bucketExpr} AS bucket_date,
          q.fingerprint_id
        FROM questions q
        WHERE q.fingerprint_id IS NOT NULL
          AND q.answertext IS NOT NULL
          AND ${channelClause}
          ${periodFilter}
      )
      SELECT
        ${dateLabelExpr} AS date,
        COUNT(DISTINCT pu.fingerprint_id) AS "uniqueUsersCount",
        COUNT(DISTINCT CASE
          WHEN DATE(TO_TIMESTAMP(fs.first_seen_ets / 1000.0) AT TIME ZONE 'Asia/Kolkata') = DATE(pu.bucket_date)
          THEN pu.fingerprint_id
        END) AS "newUsersCount",
        COUNT(DISTINCT CASE
          WHEN DATE(TO_TIMESTAMP(fs.first_seen_ets / 1000.0) AT TIME ZONE 'Asia/Kolkata') < DATE(pu.bucket_date)
          THEN pu.fingerprint_id
        END) AS "returningUsersCount",
        EXTRACT(EPOCH FROM pu.bucket_date) * 1000 AS timestamp,
        ${
          granularity === "hourly"
            ? "EXTRACT(HOUR FROM pu.bucket_date) AS hour_of_day"
            : "NULL AS hour_of_day"
        }
      FROM period_users pu
      INNER JOIN first_seen fs ON fs.fingerprint_id = pu.fingerprint_id
      GROUP BY pu.bucket_date
      ORDER BY pu.bucket_date ASC
    `;

    const result = await pool.query(query, queryParams);
    const graphData = result.rows.map((row) => ({
      date: row.date,
      timestamp: parseInt(row.timestamp, 10),
      uniqueUsersCount: parseInt(row.uniqueUsersCount, 10) || 0,
      newUsersCount: parseInt(row.newUsersCount, 10) || 0,
      returningUsersCount: parseInt(row.returningUsersCount, 10) || 0,
      ...(granularity === "hourly" && {
        hour: parseInt(row.hour_of_day, 10) || 0,
      }),
      ...(granularity === "weekly" && { week: row.date }),
      ...(granularity === "monthly" && { month: row.date }),
    }));

    const totalUniqueUsers = Math.max(
      ...graphData.map((item) => item.uniqueUsersCount),
      0,
    );
    const peakPeriod = graphData.reduce(
      (max, item) =>
        item.uniqueUsersCount > max.uniqueUsersCount ? item : max,
      { uniqueUsersCount: 0, date: null },
    );

    return res.status(200).json({
      success: true,
      data: graphData,
      metadata: {
        granularity,
        totalDataPoints: graphData.length,
        dateRange: {
          start: graphData.length > 0 ? graphData[0].date : null,
          end: graphData.length > 0 ? graphData[graphData.length - 1].date : null,
        },
        summary: {
          totalUniqueUsers,
          peakActivity: {
            date: peakPeriod.date,
            uniqueUsersCount: peakPeriod.uniqueUsersCount,
          },
        },
      },
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
    console.error("Error fetching devices graph:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

module.exports = {
  getDevices,
  getDeviceGraph,
};
