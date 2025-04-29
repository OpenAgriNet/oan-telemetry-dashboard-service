/**
 * Users API Routes
 */

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const { validatePagination } = require('../middleware/validation');

module.exports = (pool) => {
  /**
   * @route GET /api/users
   * @description Retrieve all users with pagination
   * @param {number} page - Page number
   * @param {number} pageSize - Items per page
   */
  router.get('/', validatePagination, async (req, res, next) => {
    try {
      const { page = 1, pageSize = 10 } = req.query;
      const offset = (page - 1) * pageSize;
      
      // Query to get unique users from questions or feedback tables
      const query = `
        SELECT DISTINCT uid, 
               MAX(created_at) as last_activity
        FROM (
          SELECT uid, created_at FROM questions
          UNION ALL
          SELECT uid, created_at FROM feedback
        ) as combined_users
        GROUP BY uid
        ORDER BY last_activity DESC
        LIMIT $1 OFFSET $2
      `;
      
      // Count total users
      const countQuery = `
        SELECT COUNT(DISTINCT uid) as total
        FROM (
          SELECT uid FROM questions
          UNION
          SELECT uid FROM feedback
        ) as unique_users
      `;
      
      // Execute queries
      const { rows } = await pool.query(query, [pageSize, offset]);
      const countResult = await pool.query(countQuery);
      const total = parseInt(countResult.rows[0].total);
      
      // Get additional user activity data
      const usersWithStats = await Promise.all(rows.map(async (user) => {
        // Count sessions for this user
        const sessionsQuery = `
          SELECT COUNT(DISTINCT sid) as session_count
          FROM (
            SELECT sid FROM questions WHERE uid = $1
            UNION
            SELECT sid FROM feedback WHERE uid = $1
          ) as user_sessions
        `;
        
        // Count questions for this user
        const questionsQuery = `
          SELECT COUNT(*) as question_count
          FROM questions
          WHERE uid = $1
        `;
        
        // Count feedback entries for this user
        const feedbackQuery = `
          SELECT COUNT(*) as feedback_count
          FROM feedback
          WHERE uid = $1
        `;
        
        const sessionsResult = await pool.query(sessionsQuery, [user.uid]);
        const questionsResult = await pool.query(questionsQuery, [user.uid]);
        const feedbackResult = await pool.query(feedbackQuery, [user.uid]);
        
        return {
          id: user.uid,
          lastActivity: user.last_activity,
          sessionCount: parseInt(sessionsResult.rows[0].session_count),
          questionCount: parseInt(questionsResult.rows[0].question_count),
          feedbackCount: parseInt(feedbackResult.rows[0].feedback_count)
        };
      }));
      
      res.status(200).json({
        data: usersWithStats,
        pagination: {
          total,
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          totalPages: Math.ceil(total / pageSize)
        }
      });
    } catch (err) {
      logger.error(`Error retrieving users: ${err.message}`);
      next(err);
    }
  });

  return router;
};
