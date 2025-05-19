const pool = require('../services/db');

const getSessions = async (req, res) => {
  try {
    console.log('Fetching sessions...');
    const query = `
      WITH combined_sessions AS (
        SELECT 
          sid,
          uid,
          questiontext,
          ets
        FROM questions
        WHERE sid IS NOT NULL
        UNION ALL
        SELECT 
          sid,
          uid,
          NULL as questiontext,
          ets
        FROM feedback
        WHERE sid IS NOT NULL
        UNION ALL
        SELECT 
          sid,
          uid,
          NULL as questiontext,
          ets
        FROM errordetails
        WHERE sid IS NOT NULL
      )
      SELECT 
        sid as session_id,
        uid as username,
        COUNT(questiontext) as question_count,
        MAX(ets) as session_time
      FROM combined_sessions
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
