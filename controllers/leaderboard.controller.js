const pool = require("../services/db");
const {
  getVillagesByTalukaUtil,
  getVillagesByDistrictUtil,
} = require("../middleware/villageMiddleware");
const { get } = require("../routes/leaderboard.Routes");

// Get top 10 users by taluka, district and state

const getTop10ByTaluka = async (req, res) => {
  try {
    // Get lgd_code from JWT token (extracted by leaderboardAuthController)
    const registeredLgdCode =
      req.registeredLgdCode || req.user.registered_lgd_code;

    if (!registeredLgdCode) {
      return res.status(400).json({
        success: false,
        message: "Registered location lgd_code not found in user token",
      });
    }

    // Get all villages in the same taluka using the village middleware utility
    const talukaInfo = getVillagesByTalukaUtil(registeredLgdCode);

    if (!talukaInfo.success) {
      return res.status(404).json({
        success: false,
        message: talukaInfo.message || "Could not find village information",
      });
    }

    // Extract village codes (lgd_codes) for the entire taluka
    const villageCodes = talukaInfo.data.village_codes;

    const query = `
      SELECT 
        unique_id,
        username,
        registered_location,
        record_count
      FROM leaderboard
      WHERE registered_location->>'lgd_code' = ANY($1::text[])
        AND unique_id IS NOT NULL
        AND unique_id <> ''
      ORDER BY record_count DESC
      LIMIT 10
    `;

    const result = await pool.query(query, [villageCodes.map(String)]);

    return res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount,
      taluka_info: {
        taluka_name: talukaInfo.data.taluka_name,
        district_name: talukaInfo.data.district_name,
        total_villages: talukaInfo.data.total_villages,
      },
    });
  } catch (error) {
    console.error("Error in getTop10ByTaluka:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getTop10ByDistrict = async (req, res) => {
  try {
    // Get lgd_code from JWT token (extracted by leaderboardAuthController)
    const registeredLgdCode =
      req.registeredLgdCode || req.user.registered_lgd_code;

    if (!registeredLgdCode) {
      return res.status(400).json({
        success: false,
        message: "Registered location lgd_code not found in user token",
      });
    }

    // Get all villages in the same district using the village middleware utility
    const districtInfo = getVillagesByDistrictUtil(registeredLgdCode);

    if (!districtInfo.success) {
      return res.status(404).json({
        success: false,
        message: districtInfo.message || "Could not find district information",
      });
    }

    // Extract village codes (lgd_codes) for the entire district
    const villageCodes = districtInfo.data.village_codes.map(String); // ensure strings

    const query = `
      SELECT 
        unique_id,
        username,
        registered_location,
        record_count
      FROM leaderboard
      WHERE registered_location->>'lgd_code' = ANY($1::text[])
        AND unique_id IS NOT NULL
        AND unique_id <> ''
      ORDER BY record_count DESC
      LIMIT 10
    `;

    const result = await pool.query(query, [villageCodes]);

    return res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount,
      district_info: {
        district_name: districtInfo.data.district_name,
        total_villages: districtInfo.data.total_villages,
      },
    });
  } catch (error) {
    console.error("Error in getTop10ByDistrict:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getTop10ByState = async (req, res) => {
  try {
    // Get lgd_code from JWT token (extracted by leaderboardAuthController)
    const registeredLgdCode =
      req.registeredLgdCode || req.user.registered_lgd_code;

    if (!registeredLgdCode) {
      return res.status(400).json({
        success: false,
        message: "Registered location lgd_code not found in user token",
      });
    }

    const query = `
      SELECT 
        unique_id,
        username,
        registered_location,
        record_count
      FROM leaderboard
      WHERE unique_id IS NOT NULL
        AND unique_id <> ''
      ORDER BY record_count DESC
      LIMIT 10
    `;

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount,
    });
  } catch (error) {
    console.error("Error in getTop10ByState:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get all users by district, taluka and village codes

const getUsersByDistrict = async (req, res) => {
  try {
    // 1️⃣ Parse query params
    const districtParam = req.query.district_code;
    const page = Math.max(1, parseInt(req.query.page || "1", 10)); // default page = 1
    const perPage = 10; // fixed page size = 10
    const offset = (page - 1) * perPage;
    // Split comma-separated codes into array
    const districtCodes = String(districtParam || "")
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean);

    if (districtCodes.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "district_code is required" });
    }

    // 2️⃣ Count total users in those districts
    const countResult = await pool.query(
      `SELECT COUNT(*)::bigint AS total FROM public.leaderboard WHERE district_code::text = ANY($1::text[])`,
      [districtCodes]
    );
    const total = Number(countResult.rows[0].total);
    const totalPages = Math.ceil(total / perPage);

    // 3️⃣ Get actual paginated data
    const dataResult = await pool.query(
      `SELECT unique_id, username, record_count, village_code, taluka_code, district_code
       FROM public.leaderboard
       WHERE district_code::text = ANY($1::text[])
       ORDER BY record_count DESC
       LIMIT $2 OFFSET $3`,
      [districtCodes, perPage, offset]
    );

    // 4️⃣ Return response
    return res.json({
      success: true,
      page,
      per_page: perPage,
      total,
      total_pages: totalPages,
      count: dataResult.rows.length,
      data: dataResult.rows,
    });
  } catch (err) {
    console.error("Error in getUsersByDistrict:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

const getUsersByTaluka = async (req, res) => {
  try {
    // 1️⃣ Parse query params
    const talukaParam = req.query.taluka_code;
    const page = Math.max(1, parseInt(req.query.page || "1", 10)); // default page = 1
    const perPage = 10;
    const offset = (page - 1) * perPage;

    // Split comma-separated codes into array
    const talukaCodes = String(talukaParam || "")
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean);

    if (talukaCodes.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "taluka_code is required" });
    }

    // 2️⃣ Count total users
    const countResult = await pool.query(
      `SELECT COUNT(*)::bigint AS total 
       FROM public.leaderboard 
       WHERE taluka_code::text = ANY($1::text[])`,
      [talukaCodes]
    );
    const total = Number(countResult.rows[0].total);
    const totalPages = Math.ceil(total / perPage);

    // 3️⃣ Get paginated users
    const dataResult = await pool.query(
      `SELECT unique_id, username, record_count, village_code, taluka_code, district_code
       FROM public.leaderboard
       WHERE taluka_code::text = ANY($1::text[])
       ORDER BY record_count DESC
       LIMIT $2 OFFSET $3`,
      [talukaCodes, perPage, offset]
    );

    // 4️⃣ Return
    return res.json({
      success: true,
      page,
      per_page: perPage,
      total,
      total_pages: totalPages,
      count: dataResult.rows.length,
      data: dataResult.rows,
    });
  } catch (err) {
    console.error("Error in getUsersByTaluka:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

const getUsersByVillage = async (req, res) => {
  try {
    // 1️⃣ Parse query params
    const villageParam = req.query.village_code;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const perPage = 10;
    const offset = (page - 1) * perPage;

    const villageCodes = String(villageParam || "")
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean);

    if (villageCodes.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "village_code is required" });
    }

    // 2️⃣ Count total users
    const countResult = await pool.query(
      `SELECT COUNT(*)::bigint AS total 
       FROM public.leaderboard 
       WHERE village_code::text = ANY($1::text[])`,
      [villageCodes]
    );
    const total = Number(countResult.rows[0].total);
    const totalPages = Math.ceil(total / perPage);

    // 3️⃣ Get paginated users
    const dataResult = await pool.query(
      `SELECT unique_id, username, record_count, village_code, taluka_code, district_code
       FROM public.leaderboard
       WHERE village_code::text = ANY($1::text[])
       ORDER BY record_count DESC
       LIMIT $2 OFFSET $3`,
      [villageCodes, perPage, offset]
    );

    // 4️⃣ Return
    return res.json({
      success: true,
      page,
      per_page: perPage,
      total,
      total_pages: totalPages,
      count: dataResult.rows.length,
      data: dataResult.rows,
    });
  } catch (err) {
    console.error("Error in getUsersByVillage:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

module.exports = {
  getTop10ByTaluka,
  getTop10ByDistrict,
  getTop10ByState,
  getUsersByDistrict,
  getUsersByTaluka,
  getUsersByVillage,
};
