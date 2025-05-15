const pool = require('../services/db');

const getQuestions = async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        qid,
        question_text AS question,
        answer_text AS answer,
        question_type,
        uid AS user_id,
        created_at,
        event_ets,
        channel,
        sid AS session_id
      FROM flattened_events
      WHERE question_text IS NOT NULL
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query);

    const formattedData = result.rows.map(row => {
      console.log('event_ets value:', row.event_ets);
      let dateAsked = null;
      try {
        if (row.event_ets) {
          // First try to parse the timestamp if it's in milliseconds
          const timestamp = parseInt(row.event_ets);
          console.log('timestamp:', timestamp);
          if (!isNaN(timestamp)) {
            dateAsked = new Date(timestamp).toISOString().slice(0, 19);
            console.log('dateAsked:', dateAsked);
          } else {
            // If not a timestamp, try parsing as a date string
            dateAsked = new Date(row.event_ets).toISOString().slice(0, 19);
            console.log('dateAsked:', dateAsked);
          }
        }
      } catch (err) {
        console.warn('Could not parse date:', row.event_ets);
      }

      return {
        ...row,
        dateAsked,
        hasVoiceInput: false,
        reaction: "neutral"
      };
    });

    res.status(200).json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};


module.exports = {
  getQuestions
};
