const pool = require("../services/db");
const {
  formatDateToIST,
  parseDateRange,
} = require("../utils/dateUtils");
const { mvExists } = require("../utils/mvHealth");

async function fetchTtsFromDB(
  page = 1,
  limit = 10,
  search = "",
  startDate = null,
  endDate = null,
  sortBy = null,
  sortOrder = "DESC",
) {
  const offset = (page - 1) * limit;
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  let query = `
    SELECT
      id,
      sid,
      language,
      text,
      success,
      latencyms,
      statuscode,
      errorcode,
      errormessage,
      apitype,
      apiservice,
      channel,
      ets
    FROM tts_details
    WHERE ets IS NOT NULL
  `;

  const queryParams = [];
  let paramIndex = 0;

  if (startTimestamp !== null) {
    paramIndex++;
    query += ` AND ets >= $${paramIndex}`;
    queryParams.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND ets <= $${paramIndex}`;
    queryParams.push(endTimestamp);
  }

  if (search && search.trim() !== "") {
    paramIndex++;
    query += ` AND (
      sid ILIKE $${paramIndex} OR
      language ILIKE $${paramIndex} OR
      text ILIKE $${paramIndex} OR
      apitype ILIKE $${paramIndex} OR
      apiservice ILIKE $${paramIndex}
    )`;
    queryParams.push(`%${search.trim()}%`);
  }

  const sortArray = ["ets", "sid", "language", "latencyms", "statuscode", "success"];

  if (sortArray.includes(sortBy)) {
    query += ` ORDER BY ${sortBy} ${sortOrder}`;
  } else {
    query += ` ORDER BY ets DESC`;
  }

  paramIndex++;
  query += ` LIMIT $${paramIndex}`;
  queryParams.push(limit);

  paramIndex++;
  query += ` OFFSET $${paramIndex}`;
  queryParams.push(offset);

  const result = await pool.query(query, queryParams);
  return result.rows;
}

async function getTtsCount(search = "", startDate = null, endDate = null) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  let query = `
    SELECT COUNT(*) as total
    FROM tts_details
    WHERE ets IS NOT NULL
  `;

  const queryParams = [];
  let paramIndex = 0;

  if (startTimestamp !== null) {
    paramIndex++;
    query += ` AND ets >= $${paramIndex}`;
    queryParams.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND ets <= $${paramIndex}`;
    queryParams.push(endTimestamp);
  }

  if (search && search.trim() !== "") {
    paramIndex++;
    query += ` AND (
      sid ILIKE $${paramIndex} OR
      language ILIKE $${paramIndex} OR
      text ILIKE $${paramIndex} OR
      apitype ILIKE $${paramIndex} OR
      apiservice ILIKE $${paramIndex}
    )`;
    queryParams.push(`%${search.trim()}%`);
  }

  const result = await pool.query(query, queryParams);
  return parseInt(result.rows[0].total);
}

async function getTtsStats(startDate = null, endDate = null) {
  const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

  // MV-first via mv_tts_daily.
  if (startTimestamp !== null && endTimestamp !== null && await mvExists('mv_tts_daily')) {
    try {
      const mvRes = await pool.query(
        `SELECT
           COALESCE(SUM(total_calls), 0) AS total_calls,
           COALESCE(SUM(success_count), 0) AS success_count,
           ROUND(AVG(avg_latency)) AS avg_latency,
           MAX(max_latency) AS max_latency
         FROM mv_tts_daily
         WHERE stat_date >= DATE(TO_TIMESTAMP($1::bigint / 1000) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
           AND stat_date <= DATE(TO_TIMESTAMP($2::bigint / 1000) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')`,
        [startTimestamp, endTimestamp]
      );
      const row = mvRes.rows[0];
      const totalCalls = parseInt(row.total_calls) || 0;
      const successCount = parseInt(row.success_count) || 0;
      return {
        totalCalls,
        successCount,
        successRate: totalCalls > 0 ? Math.round((successCount / totalCalls) * 100) : 0,
        avgLatency: parseInt(row.avg_latency) || 0,
        maxLatency: parseInt(row.max_latency) || 0,
      };
    } catch (mvErr) {
      console.warn('[TtsStats] MV query failed, falling back:', mvErr.message);
    }
  }

  let query = `
    SELECT
      COUNT(*) as total_calls,
      SUM(CASE WHEN success = true THEN 1 ELSE 0 END) as success_count,
      ROUND(AVG(latencyms)) as avg_latency,
      MAX(latencyms) as max_latency
    FROM tts_details
    WHERE ets IS NOT NULL
  `;

  const queryParams = [];
  let paramIndex = 0;

  if (startTimestamp !== null) {
    paramIndex++;
    query += ` AND ets >= $${paramIndex}`;
    queryParams.push(startTimestamp);
  }

  if (endTimestamp !== null) {
    paramIndex++;
    query += ` AND ets <= $${paramIndex}`;
    queryParams.push(endTimestamp);
  }

  const result = await pool.query(query, queryParams);
  const row = result.rows[0];
  const totalCalls = parseInt(row.total_calls) || 0;
  const successCount = parseInt(row.success_count) || 0;
  return {
    totalCalls,
    successCount,
    successRate: totalCalls > 0 ? Math.round((successCount / totalCalls) * 100) : 0,
    avgLatency: parseInt(row.avg_latency) || 0,
    maxLatency: parseInt(row.max_latency) || 0,
  };
}

function formatTtsRecord(row) {
  const createdAt = row.ets ? formatDateToIST(parseInt(row.ets)) : null;

  return {
    id: row.id,
    sid: row.sid,
    language: row.language,
    text: row.text,
    success: row.success,
    latencyMs: row.latencyms,
    statusCode: row.statuscode,
    errorCode: row.errorcode,
    errorMessage: row.errormessage,
    apiType: row.apitype,
    apiService: row.apiservice,
    channel: row.channel,
    createdAt,
    ets: row.ets,
  };
}

const getTts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const search = req.query.search ? String(req.query.search).trim() : "";
    const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
    const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
    const sortBy = req.query.sortBy;
    const sortOrder = req.query.sortOrder === "asc" ? "ASC" : "DESC";

    if (search.length > 1000) {
      return res.status(400).json({ message: "Search term too long" });
    }

    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    if (
      (startDate && startTimestamp === null) ||
      (endDate && endTimestamp === null)
    ) {
      return res.status(400).json({
        message: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp",
      });
    }

    if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
      return res.status(400).json({ message: "Start date cannot be after end date" });
    }

    const [rawData, totalCount, stats] = await Promise.all([
      fetchTtsFromDB(page, limit, search, startDate, endDate, sortBy, sortOrder),
      getTtsCount(search, startDate, endDate),
      getTtsStats(startDate, endDate),
    ]);

    const formattedData = rawData.map(formatTtsRecord);

    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    res.status(200).json({
      data: formattedData,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: totalCount,
        itemsPerPage: limit,
        hasNextPage,
        hasPreviousPage,
        nextPage: hasNextPage ? page + 1 : null,
        previousPage: hasPreviousPage ? page - 1 : null,
      },
      stats,
      filters: {
        search,
        startDate,
        endDate,
        appliedStartTimestamp: startTimestamp,
        appliedEndTimestamp: endTimestamp,
      },
    });
  } catch (error) {
    console.error("Error fetching TTS data:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

module.exports = {
  getTts,
};
