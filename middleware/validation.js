/**
 * Validation Middleware
 */

const logger = require('../logger');

/**
 * Validate pagination parameters
 */
function validatePagination(req, res, next) {
  const { page, pageSize } = req.query;
  
  // Set default values if not provided
  if (!page) req.query.page = 1;
  if (!pageSize) req.query.pageSize = 10;
  
  // Validate page
  if (page && (!Number.isInteger(Number(page)) || Number(page) < 1)) {
    logger.warn(`Invalid page parameter: ${page}`);
    return res.status(400).json({
      error: {
        message: 'Invalid page parameter. Must be a positive integer.',
        code: 'INVALID_PAGINATION'
      }
    });
  }
  
  // Validate pageSize
  if (pageSize && (!Number.isInteger(Number(pageSize)) || Number(pageSize) < 1 || Number(pageSize) > 100)) {
    logger.warn(`Invalid pageSize parameter: ${pageSize}`);
    return res.status(400).json({
      error: {
        message: 'Invalid pageSize parameter. Must be a positive integer between 1 and 100.',
        code: 'INVALID_PAGINATION'
      }
    });
  }
  
  next();
}

/**
 * Validate date range parameters
 */
function validateDateRange(req, res, next) {
  const { startDate, endDate } = req.query;
  
  // Validate startDate format
  if (startDate && isNaN(Date.parse(startDate))) {
    logger.warn(`Invalid startDate parameter: ${startDate}`);
    return res.status(400).json({
      error: {
        message: 'Invalid startDate parameter. Must be a valid date in ISO format (YYYY-MM-DD).',
        code: 'INVALID_DATE_RANGE'
      }
    });
  }
  
  // Validate endDate format
  if (endDate && isNaN(Date.parse(endDate))) {
    logger.warn(`Invalid endDate parameter: ${endDate}`);
    return res.status(400).json({
      error: {
        message: 'Invalid endDate parameter. Must be a valid date in ISO format (YYYY-MM-DD).',
        code: 'INVALID_DATE_RANGE'
      }
    });
  }
  
  // Validate that startDate is before endDate
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    logger.warn(`startDate (${startDate}) is after endDate (${endDate})`);
    return res.status(400).json({
      error: {
        message: 'Invalid date range. startDate must be before or equal to endDate.',
        code: 'INVALID_DATE_RANGE'
      }
    });
  }
  
  next();
}

module.exports = {
  validatePagination,
  validateDateRange
};
