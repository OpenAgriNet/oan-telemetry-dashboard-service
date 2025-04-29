/**
 * Sessions API Routes
 */

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const { validatePagination, validateDateRange } = require('../middleware/validation');

module.exports = (pool) => {
  /**
   * @route GET /api/sessions
   * @description Retrieve all sessions with pagination
   * @param {number} page - Page number
   * @param {number} pageSize - Items per page
   */
  router.get('/', validatePagination, async (req, res, next) => {
    try {
      const { page = 1, pageSize = 10 } = req.query;
      const offset = (page - 1) * pageSize;
      
      // Query to get unique sessions from questions or feedback tables
      const query = `
        SELECT DISTINCT sid, 
               MIN(created_at) as start_time,
               MAX(created_at) as end_time,
               MAX(uid) as uid
        FROM (
          SELECT sid, created_at, uid FROM questions
          UNION ALL
          SELECT sid, created_at, uid FROM feedback
        ) as combined_sessions
        GROUP BY sid
        ORDER BY start_time DESC
        LIMIT $1 OFFSET $2
      `;
      
      // Count total sessions
      const countQuery = `
        SELECT COUNT(DISTINCT sid) as total
        FROM (
          SELECT sid FROM questions
          UNION
          SELECT sid FROM feedback
        ) as unique_sessions
      `;
      
      // Execute queries
      const { rows } = await pool.query(query, [pageSize, offset]);
      const countResult = await pool.query(countQuery);
      const total = parseInt(countResult.rows[0].total);
      
      // Get additional session activity data
      const sessionsWithStats = await Promise.all(rows.map(async (session) => {
        // Count events for this session
        const eventsQuery = `
          SELECT 
            COUNT(*) as total_events,
            COUNT(CASE WHEN eid = 'OE_ITEM_RESPONSE' THEN 1 END) as question_events,
            COUNT(CASE WHEN eid = 'Feedback' THEN 1 END) as feedback_events
          FROM (
            SELECT 'OE_ITEM_RESPONSE' as eid FROM questions WHERE sid = $1
            UNION ALL
            SELECT 'Feedback' as eid FROM feedback WHERE sid = $1
          ) as session_events
        `;
        
        const eventsResult = await pool.query(eventsQuery, [session.sid]);
        
        // Calculate duration in seconds
        const durationMs = new Date(session.end_time) - new Date(session.start_time);
        const durationSeconds = Math.floor(durationMs / 1000);
        
        return {
          id: session.sid,
          userId: session.uid,
          startTime: session.start_time,
          endTime: session.end_time,
          durationSeconds,
          totalEvents: parseInt(eventsResult.rows[0].total_events),
          questionEvents: parseInt(eventsResult.rows[0].question_events),
          feedbackEvents: parseInt(eventsResult.rows[0].feedback_events)
        };
      }));
      
      res.status(200).json({
        data: sessionsWithStats,
        pagination: {
          total,
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          totalPages: Math.ceil(total / pageSize)
        }
      });
    } catch (err) {
      logger.error(`Error retrieving sessions: ${err.message}`);
      next(err);
    }
  });

  /**
   * @route GET /api/sessions/report
   * @description Generate a sessions report with optional filters
   * @param {number} page - Page number
   * @param {number} pageSize - Items per page
   * @param {string} userId - Filter by user ID
   * @param {string} startDate - Filter by start date (ISO format)
   * @param {string} endDate - Filter by end date (ISO format)
   */
  router.get('/report', validatePagination, validateDateRange, async (req, res, next) => {
    try {
      const { 
        page = 1, 
        pageSize = 10,
        userId,
        startDate,
        endDate
      } = req.query;
      
      const offset = (page - 1) * pageSize;
      const params = [];
      let paramIndex = 1;
      
      // Build WHERE clause based on filters
      let whereClause = '';
      const conditions = [];
      
      if (userId) {
        conditions.push(`uid = $${paramIndex++}`);
        params.push(userId);
      }
      
      if (startDate) {
        conditions.push(`created_at >= $${paramIndex++}`);
        params.push(startDate);
      }
      
      if (endDate) {
        conditions.push(`created_at <= $${paramIndex++}`);
        params.push(endDate);
      }
      
      if (conditions.length > 0) {
        whereClause = `WHERE ${conditions.join(' AND ')}`;
      }
      
      // Main query with filters
      const baseQuery = `
        FROM (
          SELECT sid, created_at, uid FROM questions ${whereClause ? whereClause : ''}
          UNION ALL
          SELECT sid, created_at, uid FROM feedback ${whereClause ? whereClause : ''}
        ) as filtered_events
      `;
      
      // Query to get session data with aggregations
      const query = `
        SELECT 
          sid,
          MIN(created_at) as start_time,
          MAX(created_at) as end_time,
          MAX(uid) as uid
        ${baseQuery}
        GROUP BY sid
        ORDER BY start_time DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;
      
      // Add pagination parameters
      params.push(pageSize, offset);
      
      // Count total matching sessions
      const countQuery = `
        SELECT COUNT(DISTINCT sid) as total
        ${baseQuery}
      `;
      
      // Execute queries
      const { rows } = await pool.query(query, params);
      const countResult = await pool.query(countQuery, params.slice(0, paramIndex - 2));
      const total = parseInt(countResult.rows[0].total);
      
      // Enhance session data with additional metrics
      const sessionsReport = await Promise.all(rows.map(async (session) => {
        // Get event counts and other metrics
        const metricsQuery = `
          SELECT
            COUNT(DISTINCT q.id) as questions_count,
            COUNT(DISTINCT f.id) as feedback_count,
            AVG(CASE WHEN q.answer_text IS NOT NULL THEN json_array_length(q.answer_text::json) ELSE 0 END) as avg_answer_length
          FROM
            (SELECT sid FROM (${baseQuery.replace('as filtered_events', 'as fe')}) as s WHERE sid = $1) as session_data
            LEFT JOIN questions q ON session_data.sid = q.sid
            LEFT JOIN feedback f ON session_data.sid = f.sid
        `;
        
        const metricsResult = await pool.query(metricsQuery, [session.sid]);
        
        // Calculate duration
        const durationMs = new Date(session.end_time) - new Date(session.start_time);
        const durationMinutes = Math.round(durationMs / 60000 * 10) / 10; // Round to 1 decimal place
        
        return {
          sessionId: session.sid,
          userId: session.uid,
          startTime: session.start_time,
          endTime: session.end_time,
          durationMinutes,
          questionsCount: parseInt(metricsResult.rows[0].questions_count),
          feedbackCount: parseInt(metricsResult.rows[0].feedback_count),
          avgAnswerLength: parseFloat(metricsResult.rows[0].avg_answer_length) || 0
        };
      }));
      
      res.status(200).json({
        data: sessionsReport,
        filters: {
          userId: userId || null,
          startDate: startDate || null,
          endDate: endDate || null
        },
        pagination: {
          total,
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          totalPages: Math.ceil(total / pageSize)
        }
      });
    } catch (err) {
      logger.error(`Error generating sessions report: ${err.message}`);
      next(err);
    }
  });

  /**
   * @route GET /api/sessions/:sessionId/events
   * @description Retrieve all events for a specific session
   * @param {string} sessionId - Session ID
   */
  router.get('/:sessionId/events', async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      
      // Query for questions events
      const questionsQuery = `
        SELECT
          'OE_ITEM_RESPONSE' as event_type,
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
        WHERE
          sid = $1
        ORDER BY
          created_at ASC
      `;
      
      // Query for feedback events
      const feedbackQuery = `
        SELECT
          'Feedback' as event_type,
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
        WHERE
          sid = $1
        ORDER BY
          created_at ASC
      `;
      
      // Execute queries
      const questionsResult = await pool.query(questionsQuery, [sessionId]);
      const feedbackResult = await pool.query(feedbackQuery, [sessionId]);
      
      // Combine and sort results by timestamp
      const allEvents = [
        ...questionsResult.rows,
        ...feedbackResult.rows
      ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      
      // Get session metadata
      const sessionMetadataQuery = `
        SELECT
          sid,
          uid,
          MIN(created_at) as start_time,
          MAX(created_at) as end_time,
          COUNT(*) as event_count
        FROM (
          SELECT sid, uid, created_at FROM questions WHERE sid = $1
          UNION ALL
          SELECT sid, uid, created_at FROM feedback WHERE sid = $1
        ) as session_events
        GROUP BY sid, uid
      `;
      
      const metadataResult = await pool.query(sessionMetadataQuery, [sessionId]);
      const metadata = metadataResult.rows.length > 0 ? metadataResult.rows[0] : null;
      
      if (!metadata) {
        return res.status(404).json({
          error: {
            message: `Session with ID ${sessionId} not found`,
            code: 'SESSION_NOT_FOUND'
          }
        });
      }
      
      // Calculate session duration
      const durationMs = new Date(metadata.end_time) - new Date(metadata.start_time);
      const durationSeconds = Math.floor(durationMs / 1000);
      
      res.status(200).json({
        sessionId: metadata.sid,
        userId: metadata.uid,
        startTime: metadata.start_time,
        endTime: metadata.end_time,
        durationSeconds,
        eventCount: parseInt(metadata.event_count),
        events: allEvents
      });
    } catch (err) {
      logger.error(`Error retrieving session events: ${err.message}`);
      next(err);
    }
  });

  return router;
};
