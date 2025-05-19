const pool = require('../services/db');

const getSessions = async (req, res) => {
  try {
    console.log('Fetching sessions...');
    const query = `
      SELECT 
        sid as session_id,
        uid as username,
        COUNT(question_text) as question_count,
        MAX(event_ets) as session_time
      FROM flattened_events
      WHERE sid IS NOT NULL
      GROUP BY sid, uid
      ORDER BY session_time DESC
    `;

    const result = await pool.query(query);
    console.log('Query result:', result.rows.length, 'sessions found');

    const formattedData = result.rows.map(row => {
      let sessionTime = null;
      try {
        if (row.session_time) {
          // First try to parse the timestamp if it's in milliseconds
          const timestamp = parseInt(row.session_time);
          if (!isNaN(timestamp)) {
            sessionTime = new Date(timestamp).toISOString().slice(0, 19);
          } else {
            // If not a timestamp, try parsing as a date string
            sessionTime = new Date(row.session_time).toISOString().slice(0, 19);
          }
        }
      } catch (err) {
        console.warn('Could not parse date:', row.session_time);
      }

      return {
        sessionId: row.session_id,
        username: row.username,
        questionCount: parseInt(row.question_count) || 0,
        sessionTime
      };
    });

    res.status(200).json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

module.exports = {
  getSessions
};
