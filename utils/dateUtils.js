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
 * Parses a date string and interprets it as IST time, returning UTC timestamp.
 * Handles multiple formats:
 * - Unix timestamp (numeric string): used as-is
 * - ISO string with Z suffix (e.g., 2025-12-13T00:00:00.000Z): extracts datetime and treats as IST
 * - ISO string without Z (e.g., 2025-12-13T00:00:00): treats as IST
 * - Date only (e.g., 2025-12-13): treats as IST midnight
 * 
 * @param {string} dateStr - Date string to parse
 * @returns {number|null} - UTC timestamp in milliseconds, or null if invalid
 */
function parseAsIST(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
        return null;
    }

    // If it's a pure numeric string, treat as Unix timestamp
    if (/^\d+$/.test(dateStr)) {
        return parseInt(dateStr);
    }

    // Remove the Z suffix if present - we want to interpret the datetime as IST, not UTC
    // e.g., "2025-12-13T00:00:00.000Z" → we want midnight IST, not midnight UTC
    let normalizedDateStr = dateStr.trim();
    
    // Extract datetime components regardless of the timezone suffix
    // This regex handles: YYYY-MM-DD, YYYY-MM-DDTHH:mm:ss, YYYY-MM-DDTHH:mm:ss.sss, with optional Z or timezone
    const isoMatch = normalizedDateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?)?/);
    
    if (!isoMatch) {
        // Try parsing with Date constructor as fallback
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            // If parsed successfully, extract components and treat as IST
            return createISTTimestamp(
                date.getUTCFullYear(),
                date.getUTCMonth(),
                date.getUTCDate(),
                date.getUTCHours(),
                date.getUTCMinutes(),
                date.getUTCSeconds(),
                date.getUTCMilliseconds()
            );
        }
        return null;
    }

    // Extract components from the matched groups
    const year = parseInt(isoMatch[1]);
    const month = parseInt(isoMatch[2]) - 1; // JavaScript months are 0-indexed
    const day = parseInt(isoMatch[3]);
    const hours = isoMatch[4] ? parseInt(isoMatch[4]) : 0;
    const minutes = isoMatch[5] ? parseInt(isoMatch[5]) : 0;
    const seconds = isoMatch[6] ? parseInt(isoMatch[6]) : 0;
    const milliseconds = isoMatch[7] ? parseInt(isoMatch[7].padEnd(3, '0')) : 0;

    return createISTTimestamp(year, month, day, hours, minutes, seconds, milliseconds);
}

/**
 * Creates a UTC timestamp from date components that represent IST time.
 * IST is UTC+5:30, so we subtract 5:30 from the "local" IST time to get UTC.
 * 
 * @param {number} year 
 * @param {number} month - 0-indexed (0 = January)
 * @param {number} day 
 * @param {number} hours 
 * @param {number} minutes 
 * @param {number} seconds 
 * @param {number} milliseconds 
 * @returns {number} - UTC timestamp in milliseconds
 */
function createISTTimestamp(year, month, day, hours, minutes, seconds, milliseconds) {
    // Create a date as if these components were UTC
    const utcDate = Date.UTC(year, month, day, hours, minutes, seconds, milliseconds);
    
    // IST is UTC+5:30, so to convert IST to UTC, we subtract 5:30
    // If it's 00:00 IST, the equivalent UTC is 18:30 previous day
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // 5 hours 30 minutes in milliseconds
    
    return utcDate - IST_OFFSET_MS;
}

/**
 * Parse and validate date range parameters.
 * Interprets date strings as IST time (Indian Standard Time, UTC+5:30).
 * 
 * When user sends "2025-12-13T00:00:00.000Z", we interpret it as:
 * "User wants midnight IST on Dec 13, 2025" → converts to UTC timestamp
 * 
 * @param {string|null} startDate - Start date as ISO string or Unix timestamp
 * @param {string|null} endDate - End date as ISO string or Unix timestamp
 * @returns {{ startTimestamp: number|null, endTimestamp: number|null }}
 */
function parseDateRange(startDate, endDate) {
    let startTimestamp = null;
    let endTimestamp = null;

    if (startDate) {
        startTimestamp = parseAsIST(startDate);
    }

    if (endDate) {
        endTimestamp = parseAsIST(endDate);
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
    parseAsIST,
    createISTTimestamp,
    formatDateToIST,
    getCurrentTimestamp
}; 