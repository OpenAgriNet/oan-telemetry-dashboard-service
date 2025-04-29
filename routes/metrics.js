/**
 * Metrics API Routes
 */

const express = require('express');
const router = express.Router();
const logger = require('../logger');

module.exports = (pool) => {
  /**
   * @route GET /api/metrics/daily
   * @description Retrieve daily metrics for questions and feedback
   */
  router.get('/daily', async (req, res, next) => {
    try {
      // Query to get daily question metrics for the last 30 days
      const questionsQuery = `
        SELECT
          DATE(created_at) as date,
          COUNT(*) as total_questions,
          COUNT(DISTINCT uid) as unique_users,
          COUNT(DISTINCT sid) as unique_sessions,
          COUNT(CASE WHEN answer IS NOT NULL AND trim(answer) != '' THEN 1 END) as answered_questions,
          ROUND(AVG(LENGTH(answer))) as avg_answer_length
        FROM
          questions
        WHERE
          created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY
          DATE(created_at)
        ORDER BY
          date ASC
      `;
      
      // Query to get daily feedback metrics for the last 30 days
      const feedbackQuery = `
        SELECT
          DATE(created_at) as date,
          COUNT(*) as total_feedback,
          COUNT(DISTINCT uid) as unique_users,
          COUNT(DISTINCT sid) as unique_sessions,
          COUNT(CASE WHEN feedback_type = 'positive' THEN 1 END) as positive_feedback,
          COUNT(CASE WHEN feedback_type = 'negative' THEN 1 END) as negative_feedback
        FROM
          feedback
        WHERE
          created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY
          DATE(created_at)
        ORDER BY
          date ASC
      `;
      
      // Query to get daily active users
      const usersQuery = `
        SELECT
          DATE(created_at) as date,
          COUNT(DISTINCT uid) as daily_active_users,
          COUNT(DISTINCT sid) as daily_sessions
        FROM (
          SELECT uid, sid, created_at FROM questions
          UNION ALL
          SELECT uid, sid, created_at FROM feedback
        ) as combined_events
        WHERE
          created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY
          DATE(created_at)
        ORDER BY
          date ASC
      `;
      
      // Execute queries
      const [questionsResult, feedbackResult, usersResult] = await Promise.all([
        pool.query(questionsQuery),
        pool.query(feedbackQuery),
        pool.query(usersQuery)
      ]);
      
      // Create a map of all dates in the last 30 days
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);
      
      const dateMap = {};
      for (let d = new Date(thirtyDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
        const dateString = d.toISOString().split('T')[0];
        dateMap[dateString] = {
          date: dateString,
          totalQuestions: 0,
          uniqueQuestionUsers: 0,
          uniqueQuestionSessions: 0,
          answeredQuestions: 0,
          avgAnswerLength: 0,
          totalFeedback: 0,
          uniqueFeedbackUsers: 0,
          uniqueFeedbackSessions: 0,
          positiveFeedback: 0,
          negativeFeedback: 0,
          dailyActiveUsers: 0,
          dailySessions: 0
        };
      }
      
      // Fill in question metrics
      questionsResult.rows.forEach(row => {
        const dateString = row.date.toISOString().split('T')[0];
        if (dateMap[dateString]) {
          dateMap[dateString].totalQuestions = parseInt(row.total_questions);
          dateMap[dateString].uniqueQuestionUsers = parseInt(row.unique_users);
          dateMap[dateString].uniqueQuestionSessions = parseInt(row.unique_sessions);
          dateMap[dateString].answeredQuestions = parseInt(row.answered_questions);
          dateMap[dateString].avgAnswerLength = parseInt(row.avg_answer_length);
        }
      });
      
      // Fill in feedback metrics
      feedbackResult.rows.forEach(row => {
        const dateString = row.date.toISOString().split('T')[0];
        if (dateMap[dateString]) {
          dateMap[dateString].totalFeedback = parseInt(row.total_feedback);
          dateMap[dateString].uniqueFeedbackUsers = parseInt(row.unique_users);
          dateMap[dateString].uniqueFeedbackSessions = parseInt(row.unique_sessions);
          dateMap[dateString].positiveFeedback = parseInt(row.positive_feedback);
          dateMap[dateString].negativeFeedback = parseInt(row.negative_feedback);
        }
      });
      
      // Fill in active users metrics
      usersResult.rows.forEach(row => {
        const dateString = row.date.toISOString().split('T')[0];
        if (dateMap[dateString]) {
          dateMap[dateString].dailyActiveUsers = parseInt(row.daily_active_users);
          dateMap[dateString].dailySessions = parseInt(row.daily_sessions);
        }
      });
      
      // Convert map to array and sort by date
      const dailyMetrics = Object.values(dateMap).sort((a, b) => 
        new Date(a.date) - new Date(b.date)
      );
      
      // Calculate aggregated metrics for the entire period
      const aggregatedMetrics = {
        totalDays: dailyMetrics.length,
        totalQuestions: dailyMetrics.reduce((sum, day) => sum + day.totalQuestions, 0),
        totalFeedback: dailyMetrics.reduce((sum, day) => sum + day.totalFeedback, 0),
        totalAnsweredQuestions: dailyMetrics.reduce((sum, day) => sum + day.answeredQuestions, 0),
        avgQuestionsPerDay: Math.round(dailyMetrics.reduce((sum, day) => sum + day.totalQuestions, 0) / dailyMetrics.length * 100) / 100,
        avgFeedbackPerDay: Math.round(dailyMetrics.reduce((sum, day) => sum + day.totalFeedback, 0) / dailyMetrics.length * 100) / 100,
        avgActiveUsersPerDay: Math.round(dailyMetrics.reduce((sum, day) => sum + day.dailyActiveUsers, 0) / dailyMetrics.length * 100) / 100,
        avgSessionsPerDay: Math.round(dailyMetrics.reduce((sum, day) => sum + day.dailySessions, 0) / dailyMetrics.length * 100) / 100
      };
      
      // Calculate answer rate
      aggregatedMetrics.answerRate = aggregatedMetrics.totalQuestions > 0
        ? Math.round(aggregatedMetrics.totalAnsweredQuestions / aggregatedMetrics.totalQuestions * 1000) / 10
        : 0;
      
      res.status(200).json({
        dailyMetrics,
        aggregatedMetrics,
        period: {
          startDate: dailyMetrics[0].date,
          endDate: dailyMetrics[dailyMetrics.length - 1].date,
          days: dailyMetrics.length
        }
      });
    } catch (err) {
      logger.error(`Error retrieving daily metrics: ${err.message}`);
      next(err);
    }
  });

  return router;
};