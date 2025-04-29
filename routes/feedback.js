/**
 * Feedback API Routes
 */

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const { validatePagination } = require('../middleware/validation');

module.exports = (pool) => {
  /**
   * @route GET /api/feedback
   * @description Retrieve all feedback entries with pagination
   * @param {number} page - Page number
   * @param {number} pageSize - Items per page
   */
  router.get('/', validatePagination, async (req, res, next) => {
    try {
      const { page = 1, pageSize = 10 } = req.query;
      const offset = (page - 1) * pageSize;
      
      // Query to get feedback with pagination
      const query = `
        SELECT
          id,
          uid,
          sid,
          channel,
          ets,
          feedback_text,
          session_id,
          question_text,
          answer_text,
          feedback_type,
          created_at
        FROM
          feedback
        ORDER BY
          created_at DESC
        LIMIT $1 OFFSET $2
      `;
      
      // Count total feedback entries
      const countQuery = `
        SELECT COUNT(*) as total FROM feedback
      `;
      
      // Execute queries
      const { rows } = await pool.query(query, [pageSize, offset]);
      const countResult = await pool.query(countQuery);
      const total = parseInt(countResult.rows[0].total);
      
      res.status(200).json({
        data: rows,
        pagination: {
          total,
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          totalPages: Math.ceil(total / pageSize)
        }
      });
    } catch (err) {
      logger.error(`Error retrieving feedback entries: ${err.message}`);
      next(err);
    }
  });

  /**
   * @route GET /api/feedback/:feedbackId
   * @description Retrieve specific feedback by ID
   * @param {string} feedbackId - Feedback ID
   */
  router.get('/:feedbackId', async (req, res, next) => {
    try {
      const { feedbackId } = req.params;
      
      // Query to get specific feedback by ID
      const query = `
        SELECT
          f.id,
          f.uid,
          f.sid,
          f.channel,
          f.ets,
          f.feedback_text,
          f.session_id,
          f.question_text,
          f.answer_text,
          f.feedback_type,
          f.created_at,
          (
            SELECT json_build_object(
              'totalFeedback', COUNT(*),
              'positiveFeedback', SUM(CASE WHEN feedback_type = 'positive' THEN 1 ELSE 0 END),
              'negativeFeedback', SUM(CASE WHEN feedback_type = 'negative' THEN 1 ELSE 0 END)
            )
            FROM feedback
            WHERE uid = f.uid
          ) as user_feedback_stats
        FROM
          feedback f
        WHERE
          f.id = $1
      `;
      
      // Execute query
      const { rows } = await pool.query(query, [feedbackId]);
      
      if (rows.length === 0) {
        return res.status(404).json({
          error: {
            message: `Feedback with ID ${feedbackId} not found`,
            code: 'FEEDBACK_NOT_FOUND'
          }
        });
      }
      
      // Get related questions from the same session
      const relatedQuestionsQuery = `
        SELECT
          id,
          question_text,
          answer,
          created_at
        FROM
          questions
        WHERE
          sid = $1
        ORDER BY
          created_at
        LIMIT 5
      `;
      
      const relatedQuestions = await pool.query(relatedQuestionsQuery, [rows[0].sid]);
      
      // Get session information
      const sessionQuery = `
        SELECT
          sid,
          MIN(created_at) as start_time,
          MAX(created_at) as end_time,
          COUNT(*) as total_events
        FROM (
          SELECT sid, created_at FROM questions WHERE sid = $1
          UNION ALL
          SELECT sid, created_at FROM feedback WHERE sid = $1
        ) as session_events
        GROUP BY sid
      `;
      
      const sessionInfo = await pool.query(sessionQuery, [rows[0].sid]);
      
      // Format the feedback data with related information
      const feedback = rows[0];
      const result = {
        ...feedback,
        userFeedbackStats: feedback.user_feedback_stats,
        relatedQuestions: relatedQuestions.rows,
        session: sessionInfo.rows[0] || null
      };
      
      // Remove the redundant field
      delete result.user_feedback_stats;
      
      res.status(200).json(result);
    } catch (err) {
      logger.error(`Error retrieving specific feedback: ${err.message}`);
      next(err);
    }
  });

  return router;
};
