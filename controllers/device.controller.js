const pool = require("../services/db");

const { parseDateRange } = require("../utils/dateUtils");

async function fetchDevicesFromDB(
  page = 1,
  limit = 10,
  search = "",
  startDate = null,
  endDate = null,
) {
  const offset = (page - 1) * limit;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
  const queryParams = [];
  let paramIndex = 0;
  let whereConditions = ["fingerprint_id IS NOT NULL"];

  if (startTimestamp !== null) {
    paramIndex++;
    whereConditions.push(`first_seen_at >= TO_TIMESTAMP($${paramIndex})`);
    queryParams.push(Math.floor(startTimestamp / 1000));
  }
  if (endTimestamp !== null) {
    paramIndex++;
    whereConditions.push(`first_seen_at <= TO_TIMESTAMP($${paramIndex})`);
    queryParams.push(Math.floor(endTimestamp / 1000));
  }
  if (search && search.trim() !== "") {
    paramIndex++;
    whereConditions.push(`fingerprint_id ILIKE $${paramIndex}`);
    queryParams.push(`%${search.trim()}%`);
  }

  const baseWhere = whereConditions.join(" AND ");
  const whereClause = `WHERE ${baseWhere}`;

  // For total count
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM users
    ${whereClause}
  `;

  // For paginated data
  paramIndex++;
  const dataQuery = `
    SELECT fingerprint_id, browser_code, browser_name, browser_version,
           device_code, device_name, device_model,
           os_code, os_name, os_version, first_seen_at, last_seen_at
    FROM users
    ${whereClause}
    ORDER BY last_seen_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  const dataParams = [...queryParams, limit, offset];

  const countResult = await pool.query(countQuery, queryParams);
  const dataResult = await pool.query(dataQuery, dataParams);

  return {
    total: parseInt(countResult.rows[0].total, 10),
    devices: dataResult.rows,
  };
}

const getDevices = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate
      ? String(req.query.startDate).trim()
      : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

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

    const { total, devices } = await fetchDevicesFromDB(
      page,
      limit,
      search,
      startDate,
      endDate,
    );

    res.status(200).json({
      success: true,
      data: devices,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      filters: {
        search: search,
        startDate: startDate,
        endDate: endDate,
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

module.exports = {
  // ...existing exports,
  getDevices,
  fetchDevicesFromDB,
};
