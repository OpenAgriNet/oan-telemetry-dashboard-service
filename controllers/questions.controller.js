const pool = require('../services/db');

const getQuestions = async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        uid as qid,
        questiontext AS question,
        answertext AS answer,
        uid AS user_id,
        created_at,
        ets,
        channel,
        sid AS session_id
      FROM questions
      WHERE questiontext IS NOT NULL AND answertext IS NOT NULL
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query);

    const formattedData = result.rows.map(row => {
      console.log('ets value:', row.ets);
      let dateAsked = null;
      try {
        if (row.ets) {
          // First try to parse the timestamp if it's in milliseconds
          const timestamp = parseInt(row.ets);
          console.log('timestamp:', timestamp);
          if (!isNaN(timestamp)) {
            dateAsked = new Date(timestamp).toISOString().slice(0, 19);
            console.log('dateAsked:', dateAsked);
          } else {
            // If not a timestamp, try parsing as a date string
            dateAsked = new Date(row.ets).toISOString().slice(0, 19);
            console.log('dateAsked:', dateAsked);
          }
        }
      } catch (err) {
        console.warn('Could not parse date:', row.ets);
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
