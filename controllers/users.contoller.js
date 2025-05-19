const pool = require('../services/db');
const { v4: uuidv4 } = require('uuid');

const getUsers = async (req, res) => {
  try {
    const query = `
      SELECT 
        uid as user_id,
        COUNT(DISTINCT sid) as session_count,
        MAX(event_ets) as latest_session
      FROM flattened_events
      WHERE uid IS NOT NULL
      GROUP BY uid
      ORDER BY latest_session DESC
    `;

    const result = await pool.query(query);

    const formattedData = result.rows.map(row => {
      let latestSession = null;
      try {
        if (row.latest_session) {
          // First try to parse the timestamp if it's in milliseconds
          const timestamp = parseInt(row.latest_session);
          if (!isNaN(timestamp)) {
            latestSession = new Date(timestamp).toISOString().slice(0, 19);
          } else {
            // If not a timestamp, try parsing as a date string
            latestSession = new Date(row.latest_session).toISOString().slice(0, 19);
          }
        }
      } catch (err) {
        console.warn('Could not parse date:', row.latest_session);
      }

      return {
        id: uuidv4(),
        username: row.user_id,
        sessions: parseInt(row.session_count) || 0,
        latestSession
      };
    });

    res.status(200).json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

module.exports = {
  getUsers
};
