const pool = require('../services/db');

async function fetchAllFeedbackFromDB() {
    const query = `
        SELECT 
            qid,
            uid as user_id,
            created_at,
            feedbacktype,   
            feedbacktext,
            questiontext,
            answertext,
            channel,
            sid as session_id,
            qid as question_id
        FROM feedback
        WHERE feedbacktext IS NOT NULL AND questiontext IS NOT NULL
        ORDER BY created_at DESC
    `;

    const result = await pool.query(query);
    return result.rows;
  }
    
    function formatFeedbackData(feedbackItem) {
        const dateObj = new Date(feedbackItem.created_at);
        const formattedDate = dateObj.toLocaleDateString('en-US', {
        month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  
    return {
      qid: feedbackItem.qid,
      date: formattedDate,
      user: feedbackItem.user_id, // uid is used for user's name
      question: feedbackItem.questiontext,
      sessionId: feedbackItem.sid,
      answer: feedbackItem.answertext.substring(0, 100)+"...",
      rating: feedbackItem.feedbacktype, // 'like' or 'dislike'
      feedback: feedbackItem.feedbacktext,
      id: feedbackItem.id,
    };
  }


//   id: string;
//   sessionId: string;
//   userId: string;
//   questionText: string;
//   feedback: string;
//   aiResponse?: string;
//   rating: number;
//   timestamp: string;
  
  // Controller function to get all feedback
  async function getAllFeedback(req, res) {
    try {
      const rawFeedbackData = await fetchAllFeedbackFromDB();
      const formattedFeedback = rawFeedbackData.map(formatFeedbackData);
      res.status(200).json(formattedFeedback);
    } catch (error) {
      console.error("Error fetching feedback:", error);
      res.status(500).json({ message: "Error fetching feedback data" });
    }
  }

// New function to fetch feedback by QID from the database
async function fetchFeedbackByidFromDB(id) {
  const query = {
    text: `
      SELECT 
          id,
          uid AS user_id,
          sid AS session_id,
          groupdetails,
          channel,
          ets,
          feedbacktext,
          questiontext,
          answertext,
          feedbacktype,
          created_at,
          qid AS question_id
      FROM feedback
      WHERE qid = $1
    `,
    values: [id],
  };
  const result = await pool.query(query);
  return result.rows; // qid might not be unique, so this could return multiple records
}

// Controller function to get feedback by QID
async function getFeedbackByid(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "ID is required" });
    }
    const feedbackDetails = await fetchFeedbackByidFromDB(id);
    if (feedbackDetails.length === 0) {
      return res.status(404).json({ message: "No feedback found for the given ID" });
    }
    res.status(200).json(feedbackDetails);
  } catch (error) {
    console.error("Error fetching feedback by ID:", error);
    res.status(500).json({ message: "Error fetching feedback data" });
  }
}

module.exports = {
  getAllFeedback,
  getFeedbackByid,
};
  