/**
 * Questions API Routes
 */

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const { validatePagination, validateDateRange } = require('../middleware/validation');

module.exports = (pool) => {
  /**
   * @route GET /api/questions
   * @description Retrieve all questions with pagination
   * @param {number} page - Page number
   * @param {number} pageSize - Items per page
   */
  router.get('/', validatePagination, async (req, res, next) => {
    try {
      const { page = 1, pageSize = 10 } = req.query;
      const offset = (page - 1) * pageSize;
      
      // Query to get questions with pagination
      const query = `
        SELECT
          id,
          uid,
          sid,
          channel,
          ets,
          question_text,
          question_source,
          answer_text,
          answer,
          created_at
        FROM
          questions
        ORDER BY
          created_at DESC
        LIMIT $1 OFFSET $2
      `;
      
      // Count total questions
      const countQuery = `
        SELECT COUNT(*) as total FROM questions
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
      logger.error(`Error retrieving questions: ${err.message}`);
      next(err);
    }
  });

  /**
   * @route GET /api/questions/report
   * @description Generate a questions report with optional filters
   * @param {number} page - Page number
   * @param {number} pageSize - Items per page
   * @param {string} userId - Filter by user ID
   * @param {string} sessionId - Filter by session ID
   * @param {string} startDate - Filter by start date (ISO format)
   * @param {string} endDate - Filter by end date (ISO format)
   * @param {string} searchText - Filter by question text (case-insensitive partial match)
   */
  router.get('/report', validatePagination, validateDateRange, async (req, res, next) => {
    try {
      const { 
        page = 1, 
        pageSize = 10,
        userId,
        sessionId,
        startDate,
        endDate,
        searchText
      } = req.query;
      
      const offset = (page - 1) * pageSize;
      const params = [];
      let paramIndex = 1;
      
      // Build WHERE clause based on filters
      const conditions = [];
      
      if (userId) {
        conditions.push(`uid = $${paramIndex++}`);
        params.push(userId);
      }
      
      if (sessionId) {
        conditions.push(`sid = $${paramIndex++}`);
        params.push(sessionId);
      }
      
      if (startDate) {
        conditions.push(`created_at >= $${paramIndex++}`);
        params.push(startDate);
      }
      
      if (endDate) {
        conditions.push(`created_at <= $${paramIndex++}`);
        params.push(endDate);
      }
      
      if (searchText) {
        conditions.push(`question_text ILIKE $${paramIndex++}`);
        params.push(`%${searchText}%`);
      }
      
      const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}` 
        : '';
      
      // Query to get filtered questions with pagination
      const query = `
        SELECT
          id,
          uid,
          sid,
          channel,
          question_text,
          question_source,
          answer,
          created_at,
          CASE 
            WHEN answer IS NOT NULL AND trim(answer) != '' THEN true
            ELSE false
          END as has_answer,
          LENGTH(answer) as answer_length
        FROM
          questions
        ${whereClause}
        ORDER BY
          created_at DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;
      
      // Add pagination parameters
      params.push(pageSize, offset);
      
      // Count total matching questions
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM questions
        ${whereClause}
      `;
      
      // Execute queries
      const { rows } = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, paramIndex - 2));
      const total = parseInt(countResult.rows[0].total);
      
      // Get aggregated metrics for filtered questions
      const metricsQuery = `
        SELECT
          COUNT(*) as total_questions,
          COUNT(CASE WHEN answer IS NOT NULL AND trim(answer) != '' THEN 1 END) as answered_questions,
          AVG(LENGTH(answer)) as avg_answer_length,
          MIN(created_at) as first_question_time,
          MAX(created_at) as last_question_time,
          COUNT(DISTINCT uid) as unique_users,
          COUNT(DISTINCT sid) as unique_sessions
        FROM
          questions
        ${whereClause}
      `;
      
      const metricsResult = await pool.query(metricsQuery, params.slice(0, paramIndex - 2));
      const metrics = metricsResult.rows[0];
      
      res.status(200).json({
        data: rows,
        metrics: {
          totalQuestions: parseInt(metrics.total_questions),
          answeredQuestions: parseInt(metrics.answered_questions),
          answerRate: metrics.total_questions > 0 
            ? parseFloat((metrics.answered_questions / metrics.total_questions * 100).toFixed(2)) 
            : 0,
          avgAnswerLength: Math.round(parseFloat(metrics.avg_answer_length) || 0),
          firstQuestionTime: metrics.first_question_time,
          lastQuestionTime: metrics.last_question_time,
          uniqueUsers: parseInt(metrics.unique_users),
          uniqueSessions: parseInt(metrics.unique_sessions)
        },
        filters: {
          userId: userId || null,
          sessionId: sessionId || null,
          startDate: startDate || null,
          endDate: endDate || null,
          searchText: searchText || null
        },
        pagination: {
          total,
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          totalPages: Math.ceil(total / pageSize)
        }
      });
    } catch (err) {
      logger.error(`Error generating questions report: ${err.message}`);
      next(err);
    }
  });

  return router;
};
