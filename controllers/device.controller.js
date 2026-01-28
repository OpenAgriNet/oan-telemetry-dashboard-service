const pool = require("../services/db");

const { parseDateRange } = require("../utils/dateUtils");

// async function fetchDevicesFromDB(
//   page = 1,
//   limit = 10,
//   search = "",
//   startDate = null,
//   endDate = null,
// ) {
//   const offset = (page - 1) * limit;
//   const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
//   const queryParams = [];
//   let paramIndex = 0;
//   let whereConditions = ["fingerprint_id IS NOT NULL"];

//   if (startTimestamp !== null) {
//     paramIndex++;
//     whereConditions.push(`first_seen_at >= TO_TIMESTAMP($${paramIndex})`);
//     queryParams.push(Math.floor(startTimestamp / 1000));
//   }
//   if (endTimestamp !== null) {
//     paramIndex++;
//     whereConditions.push(`first_seen_at <= TO_TIMESTAMP($${paramIndex})`);
//     queryParams.push(Math.floor(endTimestamp / 1000));
//   }
//   if (search && search.trim() !== "") {
//     paramIndex++;
//     whereConditions.push(`fingerprint_id ILIKE $${paramIndex}`);
//     queryParams.push(`%${search.trim()}%`);
//   }

//   const baseWhere = whereConditions.join(" AND ");
//   const whereClause = `WHERE ${baseWhere}`;

//   // For total count
//   const countQuery = `
//     SELECT COUNT(*) AS total
//     FROM users
//     ${whereClause}
//   `;

//   // For paginated data
//   paramIndex++;
//   const dataQuery = `
//     SELECT fingerprint_id, browser_code, browser_name, browser_version,
//            device_code, device_name, device_model,
//            os_code, os_name, os_version, first_seen_at, last_seen_at
//     FROM users
//     ${whereClause}
//     ORDER BY last_seen_at DESC
//     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
//   `;
//   const dataParams = [...queryParams, limit, offset];

//   const countResult = await pool.query(countQuery, queryParams);
//   const dataResult = await pool.query(dataQuery, dataParams);

//   return {
//     total: parseInt(countResult.rows[0].total, 10),
//     devices: dataResult.rows,
//   };
// }

// const getDevices = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = parseInt(req.query.limit, 10) || 10;
//     const search = req.query.search ? String(req.query.search).trim() : "";
//     const startDate = req.query.startDate
//       ? String(req.query.startDate).trim()
//       : null;
//     const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

//     // Validate date range
//     const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
//     if (
//       (startDate && startTimestamp === null) ||
//       (endDate && endTimestamp === null)
//     ) {
//       return res.status(400).json({
//         success: false,
//         error:
//           "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
//       });
//     }
//     if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
//       return res.status(400).json({
//         success: false,
//         error: "Start date cannot be after end date",
//       });
//     }

//     const { total, devices } = await fetchDevicesFromDB(
//       page,
//       limit,
//       search,
//       startDate,
//       endDate,
//     );

//     res.status(200).json({
//       success: true,
//       data: devices,
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//       },
//       filters: {
//         search: search,
//         startDate: startDate,
//         endDate: endDate,
//         appliedStartTimestamp: startTimestamp,
//         appliedEndTimestamp: endTimestamp,
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching devices:", error);
//     res.status(500).json({
//       success: false,
//       error: "Internal server error",
//     });
//   }
// };

async function fetchDevicesFromDB(
  page = 1,
  limit = 10,
  search = "",
  startDate = null,
  endDate = null
) {
  const offset = (page - 1) * limit;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  const params = [];
  let idx = 0;

  let where = [`q.fingerprint_id IS NOT NULL`];

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
    LEFT JOIN users u
      ON u.fingerprint_id = d.fingerprint_id
    ORDER BY d.last_activity DESC
    LIMIT ${limitParam} OFFSET ${offsetParam};
  `;

  const result = await pool.query(query, params);
  return result.rows;
}

async function getTotalAndNewDevicesCount(
  search = "",
  startDate = null,
  endDate = null
) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  const query = `
    WITH total_devices AS (
      SELECT COUNT(DISTINCT fingerprint_id) AS total
      FROM questions
      WHERE fingerprint_id IS NOT NULL
        AND ets >= $1
        AND ets <= $2
    ),
    new_devices AS (
      SELECT COUNT(DISTINCT fingerprint_id) AS new
      FROM users
      WHERE fingerprint_id IS NOT NULL
        AND first_seen_at >= $3
        AND first_seen_at <= $4
    )
    SELECT
      total_devices.total AS total_users,
      new_devices.new AS new_users
    FROM total_devices
    CROSS JOIN new_devices;
  `;

  const values = [
    startTimestamp,                  // $1
    endTimestamp,                    // $2
    new Date(startTimestamp),         // $3
    new Date(endTimestamp),           // $4
  ];

  const result = await pool.query(query, values);
  const row = result.rows[0];

  return {
    totalUsers: Number(row.total_users) || 0,
    newUsers: Number(row.new_users) || 0,
  };
}

const getDevices = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate
      ? String(req.query.endDate).trim()
      : null;

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
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
      fetchDevicesFromDB(page, limit, search, startDate, endDate),
      getTotalAndNewDevicesCount(search, startDate, endDate),
    ]);

    res.status(200).json({
      success: true,
      data: devices,
      stats: {
        totalUsers: counts.totalUsers,
        newUsers: counts.newUsers,
        returningUsers: counts.totalUsers - counts.newUsers,
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
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

const getDeviceGraph = async (req, res) => {
  try {
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const granularity = req.query.granularity
      ? String(req.query.granularity).trim()
      : "daily";
    const search = req.query.search ? String(req.query.search).trim() : "";

    // Validate granularity parameter
    if (!["daily", "hourly", "weekly", "monthly"].includes(granularity)) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid granularity. Must be 'daily', 'hourly', 'weekly', or 'monthly'",
      });
    }

    // Validate date range
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }

    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res.status(400).json({
        success: false,
        error: "Start date cannot be after end date",
      });
    }

    // Build date filtering
    let dateFilter = "";
    const queryParams = [];
    let paramIndex = 0;

    if (startTimestamp !== null) {
      paramIndex++;
      dateFilter += ` AND first_seen_at >= $${paramIndex}`;
      queryParams.push(new Date(startTimestamp));
    }

    if (endTimestamp !== null) {
      paramIndex++;
      dateFilter += ` AND first_seen_at <= $${paramIndex}`;
      queryParams.push(new Date(endTimestamp));
    }

    // Add search filter if provided
    // if (search && search.trim() !== "") {
    //   paramIndex++;
    //   dateFilter += ` AND (
    //             questiontext ILIKE $${paramIndex} OR
    //             answertext ILIKE $${paramIndex} OR
    //             uid ILIKE $${paramIndex} OR
    //             channel ILIKE $${paramIndex}
    //         )`;
    //   queryParams.push(`%${search.trim()}%`);
    // }

    // Define the date truncation and formatting based on granularity
    let dateGrouping;
    let dateFormat;
    let orderBy;

    let questionDateGrouping;
    let userDateGrouping;

    switch (granularity) {
      case "hourly":
        questionDateGrouping =
          "DATE_TRUNC('hour', TO_TIMESTAMP(q.ets / 1000) AT TIME ZONE 'Asia/Kolkata')";
        userDateGrouping =
          "DATE_TRUNC('hour', u.first_seen_at AT TIME ZONE 'Asia/Kolkata')";
        break;
      case "weekly":
        questionDateGrouping =
          "DATE_TRUNC('week', TO_TIMESTAMP(q.ets / 1000) AT TIME ZONE 'Asia/Kolkata')";
        userDateGrouping =
          "DATE_TRUNC('week', u.first_seen_at AT TIME ZONE 'Asia/Kolkata')";
        break;
      case "monthly":
        questionDateGrouping =
          "DATE_TRUNC('month', TO_TIMESTAMP(q.ets / 1000) AT TIME ZONE 'Asia/Kolkata')";
        userDateGrouping =
          "DATE_TRUNC('month', u.first_seen_at AT TIME ZONE 'Asia/Kolkata')";
        break;
      case "daily":
      default:
        questionDateGrouping =
          "DATE_TRUNC('day', TO_TIMESTAMP(q.ets / 1000) AT TIME ZONE 'Asia/Kolkata')";
        userDateGrouping =
          "DATE_TRUNC('day', u.first_seen_at AT TIME ZONE 'Asia/Kolkata')";
    }


    // Build date format string for the final SELECT (using da.activity_date)
    let finalDateFormat;
    switch (granularity) {
      case "hourly":
        finalDateFormat = "TO_CHAR(da.activity_date, 'YYYY-MM-DD HH24:00')";
        break;
      case "weekly":
      case "monthly":
        finalDateFormat = "TO_CHAR(da.activity_date, 'YYYY-MM-DD')";
        break;
      case "daily":
      default:
        finalDateFormat = "TO_CHAR(da.activity_date, 'YYYY-MM-DD')";
        break;
    }

    const query = {
      text: `
            WITH
total_users_by_bucket AS (
  SELECT
    ${questionDateGrouping} AS bucket_date,
    COUNT(DISTINCT q.fingerprint_id) AS total_users
  FROM questions q
  WHERE q.fingerprint_id IS NOT NULL
    AND q.ets >= $1
    AND q.ets <= $2
  GROUP BY bucket_date
),
new_users_by_bucket AS (
  SELECT
    ${userDateGrouping} AS bucket_date,
    COUNT(DISTINCT u.fingerprint_id) AS new_users
  FROM users u
  WHERE u.fingerprint_id IS NOT NULL
    AND u.first_seen_at >= $3
    AND u.first_seen_at <= $4
  GROUP BY bucket_date
),
merged AS (
  SELECT
    COALESCE(t.bucket_date, n.bucket_date) AS bucket_date,
    COALESCE(t.total_users, 0) AS total_users,
    COALESCE(n.new_users, 0) AS new_users
  FROM total_users_by_bucket t
  FULL OUTER JOIN new_users_by_bucket n
    ON t.bucket_date = n.bucket_date
)
SELECT
  TO_CHAR(bucket_date, 'YYYY-MM-DD') AS date,
  total_users AS uniqueUsersCount,
  new_users AS newUsersCount,
  (total_users - new_users) AS returningUsersCount,
  EXTRACT(EPOCH FROM bucket_date) * 1000 AS timestamp
FROM merged
ORDER BY bucket_date ASC;
            `,
      values: [
        startTimestamp ?? null,                 // $1 → q.ets start (ms)
        endTimestamp ?? null,                   // $2 → q.ets end (ms)
        startTimestamp ? new Date(startTimestamp) : null, // $3 → users start
        endTimestamp ? new Date(endTimestamp) : null,     // $4 → users end
      ],
    };

    const result = await pool.query(query);

    // Format the data for frontend consumption
    const graphData = result.rows.map((row) => ({
      date: row.date,
      timestamp: parseInt(row.timestamp),
      uniqueUsersCount: parseInt(row.uniqueuserscount) || 0,
      newUsersCount: parseInt(row.newuserscount) || 0,
      returningUsersCount: parseInt(row.returninguserscount) || 0,
      // Add formatted values for different time periods
      ...(granularity === "hourly" && {
        hour:
          parseInt(row.hour_of_day) ||
          parseInt(row.date?.split(" ")[1]?.split(":")[0] || "0"),
      }),
      ...(granularity === "weekly" && { week: row.date }),
      ...(granularity === "monthly" && { month: row.date }),
    }));

    // Calculate summary statistics
    const totalUniqueUsers = Math.max(
      ...graphData.map((item) => item.uniqueUsersCount),
      0,
    );
    // Find peak activity period
    const peakPeriod = graphData.reduce(
      (max, item) =>
        item.uniqueUsersCount > max.uniqueUsersCount ? item : max,
      { uniqueUsersCount: 0, date: null },
    );

    res.status(200).json({
      success: true,
      data: graphData,
      metadata: {
        granularity: granularity,
        totalDataPoints: graphData.length,
        dateRange: {
          start: graphData.length > 0 ? graphData[0].date : null,
          end:
            graphData.length > 0 ? graphData[graphData.length - 1].date : null,
        },
        summary: {
          totalUniqueUsers: totalUniqueUsers,
          peakActivity: {
            date: peakPeriod.date,
            uniqueUsersCount: peakPeriod.uniqueUsersCount,
          },
        },
      },
      filters: {
        search: search,
        startDate: startDate,
        endDate: endDate,
        granularity: granularity,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching devices graph data:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};


module.exports = {
  // ...existing exports,
  getDevices,
  getDeviceGraph,
  fetchDevicesFromDB,
};
