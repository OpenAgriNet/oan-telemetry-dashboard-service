const pool = require("../services/db");
const { getVillagesByTalukaUtil, getVillagesByDistrictUtil} = require("../middleware/villageMiddleware");
const { get } = require("../routes/leaderboard.Routes");

// Get top 10 users by taluka location  without farmer ID filter

const getTop10ByTaluka = async (req, res) => {
  try {
    // Get lgd_code from JWT token (extracted by leaderboardAuthController)
    const registeredLgdCode =
      req.registeredLgdCode || req.user.registered_lgd_code;

    const farmerId = req.query.farmer_id;

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

    query = `
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

    if (farmerId) {
      query = `
       SELECT 
        unique_id,
        username,
        registered_location,
        record_count,
        farmer_id
      FROM leaderboard
      WHERE registered_location->>'lgd_code' = ANY($1::text[])
        AND unique_id IS NOT NULL
        AND unique_id <> ''
        AND farmer_id IS NOT NULL AND farmer_id <> ''
      ORDER BY record_count DESC
      LIMIT 10`;
    }

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
    console.error("Error in getTop50ByLocation:", error);
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

    const farmerId = req.query.farmer_id;

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

    let query = `
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

    // If farmer filter requested
    if (farmerId) {
      query = `
        SELECT 
          unique_id,
          username,
          registered_location,
          record_count,
          farmer_id
        FROM leaderboard
        WHERE registered_location->>'lgd_code' = ANY($1::text[])
          AND unique_id IS NOT NULL
          AND unique_id <> ''
          AND farmer_id IS NOT NULL
          AND farmer_id <> '' 
        ORDER BY record_count DESC
        LIMIT 10
      `;
    }

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

    const farmerId = req.query.farmer_id;

    if (!registeredLgdCode) {
      return res.status(400).json({
        success: false,
        message: "Registered location lgd_code not found in user token",
      });
    }

    let query = `
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

    // If farmer filter requested
    if (farmerId) {
      query = `
        SELECT 
          unique_id,
          username,
          registered_location,
          record_count,
          farmer_id
        FROM leaderboard
        WHERE unique_id IS NOT NULL
          AND unique_id <> ''
          AND farmer_id IS NOT NULL AND farmer_id <> ''
        ORDER BY record_count DESC
        LIMIT 10
      `;
    }

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

module.exports = {
  getTop10ByTaluka,
  getTop10ByDistrict,
  getTop10ByState,
};
