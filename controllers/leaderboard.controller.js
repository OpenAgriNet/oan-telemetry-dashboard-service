const pool = require("../services/db");

// Get top 50 users by location without farmer ID filter

const getTop50ByLocation = async (req, res) => {
  try {
    // Get location from JWT token

    const { location } = req.user;

    if (!location) {
      return res.status(400).json({
        success: false,
        message: "Location not found in user token",
      });
    }

    const query = `
      SELECT 
        unique_id,
        mobile,
        username,
        email,
        role,
        farmer_id,
        registered_location,
        record_count,
        last_updated
      FROM leaderboard
      WHERE registered_location->>'location' = $1
      ORDER BY record_count DESC
      LIMIT 50
    `;

    const result = await pool.query(query, [location]);

    return res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount,
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
    // Get location from JWT token
    const { location } = req.user;

    if (!location) {
      return res.status(400).json({
        success: false,
        message: "Location not found in user token",
      });
    }

    const query = `
      SELECT 
        unique_id,
        mobile,
        username,
        email,
        role,
        farmer_id,
        registered_location,
        record_count,
        last_updated
      FROM leaderboard
      WHERE registered_location->>'location' = $1
        AND farmer_id IS NOT NULL
      ORDER BY record_count DESC
      LIMIT 50
    `;

    const result = await pool.query(query, [location]);

    return res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount,
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
