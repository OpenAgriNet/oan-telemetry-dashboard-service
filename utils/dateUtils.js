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

/**
 * Parse and validate date range parameters
 * @param {string|null} startDate - Start date as ISO string or Unix timestamp
 * @param {string|null} endDate - End date as ISO string or Unix timestamp
 * @returns {{ startTimestamp: number|null, endTimestamp: number|null }}
 */
function parseDateRange(startDate, endDate) {
    let startTimestamp = null;
    let endTimestamp = null;

    if (startDate) {
        if (typeof startDate === 'string' && /^\d+$/.test(startDate)) {
            // Unix timestamp provided
            startTimestamp = parseInt(startDate);
        } else {
            // ISO date string provided, convert to unix timestamp (milliseconds)
            const date = new Date(startDate);
            if (!isNaN(date.getTime())) {
                startTimestamp = date.getTime();
            }
        }
    }

    if (endDate) {
        if (typeof endDate === 'string' && /^\d+$/.test(endDate)) {
            // Unix timestamp provided
            endTimestamp = parseInt(endDate);
        } else {
            // ISO date string provided, convert to unix timestamp (milliseconds)
            const date = new Date(endDate);
            if (!isNaN(date.getTime())) {
                endTimestamp = date.getTime();
            }
        }
    }

    return { startTimestamp, endTimestamp };
}

/**
 * Format timestamp to IST timezone string (YYYY-MM-DD HH:mm:ss IST)
 * @param {number|string} timestamp - Unix timestamp in milliseconds or date string
 * @returns {string|null} - Formatted date string in IST or null if invalid
 */
function formatDateToIST(timestamp) {
    const date = new Date(typeof timestamp === 'string' ? timestamp : parseInt(timestamp));
    if (isNaN(date.getTime())) {
        return null;
    }
    const istDate = convertUTCToIST(date);
    // Format as YYYY-MM-DD HH:mm:ss IST
    const year = istDate.getUTCFullYear();
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istDate.getUTCDate()).padStart(2, '0');
    const hours = String(istDate.getUTCHours()).padStart(2, '0');
    const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
    const seconds = String(istDate.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} IST`;
}

/**
 * Get current timestamp for filtering out future dates
 * @returns {number} - Current Unix timestamp in milliseconds
 */
function getCurrentTimestamp() {
    return Date.now();
}

module.exports = {
    convertUTCToIST,
    formatUTCToISTDate,
    formatUTCToISTTime,
    formatUTCToISTDateTime,
    parseDateRange,
    formatDateToIST,
    getCurrentTimestamp
}; 