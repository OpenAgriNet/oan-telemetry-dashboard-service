const pool = require("../services/db");
const { getVillagesByTalukaUtil } = require("../middleware/villageMiddleware");

// Get top 50 users by location without farmer ID filter

const getTop50ByLocation = async (req, res) => {
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
        record_count,
      FROM leaderboard
      WHERE registered_location->>'lgd_code' = ANY($1::text[])
      ORDER BY record_count DESC
      LIMIT 50
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
    console.error("Error in getTop50ByLocation:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get top 50 users by location with farmer ID

const getTop50ByLocationAndFarmer = async (req, res) => {
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
        record_count,
        farmer_id
      FROM leaderboard
      WHERE registered_location->>'lgd_code' = ANY($1::text[])
        AND farmer_id IS NOT NULL
      ORDER BY record_count DESC
      LIMIT 50
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
    console.error("Error in getTop50ByLocationAndFarmer:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

module.exports = {
  getTop50ByLocation,
  getTop50ByLocationAndFarmer,
};
