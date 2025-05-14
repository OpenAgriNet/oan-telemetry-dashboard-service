const pool = require('../services/db');

const getQuestions = async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        qid,
        question_text as question,
        answer_text as answer,
        question_type,
        uid as user_id,
        created_at,
        event_ets,
        channel
      FROM flattened_events
      WHERE question_text IS NOT NULL
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query);
    
    res.status(200).json({
      success: true,
      data: result.rows
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
