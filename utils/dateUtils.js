/**
 * Utility functions for date and time conversions
 */

/**
 * Converts a UTC date to IST (UTC+5:30)
 * @param {Date|string} utcDate - UTC date object or ISO string
 * @returns {Date} Date object representing IST time
 */
function convertUTCToIST(utcDate) {
    let date;
    if (typeof utcDate === 'string') {
        date = new Date(utcDate);
    } else {
        date = new Date(utcDate.getTime());
    }
    
    // IST is UTC+5:30 (5.5 hours * 60 minutes * 60 seconds * 1000 milliseconds)
    const istOffset = 5.5 * 60 * 60 * 1000;
    return new Date(date.getTime() + istOffset);
}

/**
 * Formats a UTC date to IST date string
 * @param {Date|string} utcDate - UTC date object or ISO string
 * @param {Object} options - Formatting options for toLocaleDateString
 * @returns {string} Formatted IST date string
 */
function formatUTCToISTDate(utcDate, options = {}) {
    const istDate = convertUTCToIST(utcDate);
    
    const defaultOptions = {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC' // Use UTC since we've already converted to IST
    };
    
    return istDate.toLocaleDateString('en-US', { ...defaultOptions, ...options });
}

/**
 * Formats a UTC date to IST time string
 * @param {Date|string} utcDate - UTC date object or ISO string
 * @param {Object} options - Formatting options for toLocaleTimeString
 * @returns {string} Formatted IST time string
 */
function formatUTCToISTTime(utcDate, options = {}) {
    const istDate = convertUTCToIST(utcDate);
    
    const defaultOptions = {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'UTC' // Use UTC since we've already converted to IST
    };
    
    return istDate.toLocaleTimeString('en-US', { ...defaultOptions, ...options });
}

/**
 * Formats a UTC date to both IST date and time
 * @param {Date|string} utcDate - UTC date object or ISO string
 * @returns {Object} Object containing formatted date and time in IST
 */
function formatUTCToISTDateTime(utcDate) {
    return {
        date: formatUTCToISTDate(utcDate),
        time: formatUTCToISTTime(utcDate),
        fullDate: typeof utcDate === 'string' ? utcDate : utcDate.toISOString() // Keep original UTC ISO string
    };
}

module.exports = {
    convertUTCToIST,
    formatUTCToISTDate,
    formatUTCToISTTime,
    formatUTCToISTDateTime
}; 