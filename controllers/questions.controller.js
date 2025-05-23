const pool = require('../services/db'); // Ensure this path is correct

// Helper function to parse and validate date range parameters
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

async function fetchQuestionsFromDB(page = 1, limit = 10, search = '', startDate = null, endDate = null) {
    const offset = (page - 1) * limit;
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
    // Base query with optional search and date filtering - using parameterized queries
    let query = `
        SELECT 
            id,
            uid as qid,
            questiontext AS question,
            answertext AS answer,
            uid AS user_id,
            created_at,
            ets,
            channel,
            sid AS session_id
        FROM questions
        WHERE questiontext IS NOT NULL AND answertext IS NOT NULL
    `;
    
    const queryParams = [];
    let paramIndex = 0;
    
    // Add date range filtering
    if (startTimestamp !== null) {
        paramIndex++;
        query += ` AND ets >= $${paramIndex}`;
        queryParams.push(startTimestamp);
    }
    
    if (endTimestamp !== null) {
        paramIndex++;
        query += ` AND ets <= $${paramIndex}`;
        queryParams.push(endTimestamp);
    }
    
    // Add search functionality if search term is provided
    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` AND (
            questiontext ILIKE $${paramIndex} OR 
            answertext ILIKE $${paramIndex} OR
            uid ILIKE $${paramIndex} OR
            channel ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${search.trim()}%`);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    // Add pagination
    paramIndex++;
    query += ` LIMIT $${paramIndex}`;
    queryParams.push(limit);
    
    paramIndex++;
    query += ` OFFSET $${paramIndex}`;
    queryParams.push(offset);

    const result = await pool.query(query, queryParams);
    return result.rows;
}

async function getTotalQuestionsCount(search = '', startDate = null, endDate = null) {
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
    
    let query = `
        SELECT COUNT(*) as total
        FROM questions
        WHERE questiontext IS NOT NULL AND answertext IS NOT NULL
    `;
    
    const queryParams = [];
    let paramIndex = 0;
    
    // Add date range filtering
    if (startTimestamp !== null) {
        paramIndex++;
        query += ` AND ets >= $${paramIndex}`;
        queryParams.push(startTimestamp);
    }
    
    if (endTimestamp !== null) {
        paramIndex++;
        query += ` AND ets <= $${paramIndex}`;
        queryParams.push(endTimestamp);
    }
    
    // Add search filter to count query if search term is provided
    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` AND (
            questiontext ILIKE $${paramIndex} OR 
            answertext ILIKE $${paramIndex} OR
            uid ILIKE $${paramIndex} OR
            channel ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${search.trim()}%`);
    }
    
    const result = await pool.query(query, queryParams);
    return parseInt(result.rows[0].total);
}

function formatQuestionData(row) {
    let dateAsked = null;
    
    try {
        if (row.ets) {
            // First try to parse the timestamp if it's in milliseconds
            const timestamp = parseInt(row.ets);
            if (!isNaN(timestamp)) {
                dateAsked = new Date(timestamp).toISOString().slice(0, 19);
            } else {
                // If not a timestamp, try parsing as a date string
                dateAsked = new Date(row.ets).toISOString().slice(0, 19);
            }
        }
    } catch (err) {
        console.warn('Could not parse date:', row.ets);
        dateAsked = null;
    }

    return {
        ...row,
        dateAsked,
        hasVoiceInput: false,
        reaction: "neutral",
        timestamp: row.ets
    };
}

const getQuestions = async (req, res) => {
    try {
        // Extract and sanitize pagination parameters from query string
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const search = req.query.search ? String(req.query.search).trim() : '';
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        
        // Additional validation for search term length to prevent abuse
        if (search.length > 1000) {
            return res.status(400).json({ 
                success: false,
                error: "Search term too long" 
            });
        }
        
        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({ 
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp" 
            });
        }
        
        if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
            return res.status(400).json({ 
                success: false,
                error: "Start date cannot be after end date" 
            });
        }

        // Fetch paginated questions data and total count
        const [questionsData, totalCount] = await Promise.all([
            fetchQuestionsFromDB(page, limit, search, startDate, endDate),
            getTotalQuestionsCount(search, startDate, endDate)
        ]);

        const formattedData = questionsData.map(formatQuestionData);
        
        // Calculate pagination metadata
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPreviousPage = page > 1;

        // Return paginated response
        res.status(200).json({
            success: true,
            data: formattedData,
            pagination: {
                currentPage: page,
                totalPages: totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: hasNextPage,
                hasPreviousPage: hasPreviousPage,
                nextPage: hasNextPage ? page + 1 : null,
                previousPage: hasPreviousPage ? page - 1 : null
            },
            filters: {
                search: search,
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error('Error fetching questions:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

// Get single question by ID
const getQuestionById = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate UUID format to prevent SQL injection
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        
        if (!id || !uuidRegex.test(id)) {
            return res.status(400).json({ 
                success: false,
                error: "Valid UUID ID is required" 
            });
        }
        
        const query = {
            text: `
                SELECT 
                    id,
                    uid as qid,
                    questiontext AS question,
                    answertext AS answer,
                    uid AS user_id,
                    created_at,
                    ets,
                    channel,
                    sid AS session_id,
                    groupdetails,
                    questionsource
                FROM questions
                WHERE id = $1
            `,
            values: [id],
        };
        
        const result = await pool.query(query);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: "No question found for the given ID" 
            });
        }
        
        const formattedQuestion = formatQuestionData(result.rows[0]);
        
        res.status(200).json({
            success: true,
            data: formattedQuestion
        });
    } catch (error) {
        console.error("Error fetching question by ID:", error);
        res.status(500).json({ 
            success: false,
            error: "Error fetching question data" 
        });
    }
};

// Get questions by user ID with date filtering
const getQuestionsByUserId = async (req, res) => {
    try {
        const { userId } = req.params;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        const offset = (page - 1) * limit;
        
        if (!userId || typeof userId !== 'string' || userId.trim() === '') {
            return res.status(400).json({ 
                success: false,
                error: "Valid User ID is required" 
            });
        }
        
        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({ 
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp" 
            });
        }
        
        // Build date filtering for questions query
        let dateFilter = '';
        let countDateFilter = '';
        const queryParams = [userId.trim()];
        const countParams = [userId.trim()];
        let paramIndex = 1;
        
        if (startTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets >= $${paramIndex}`;
            countDateFilter += ` AND ets >= $${paramIndex}`;
            queryParams.push(startTimestamp);
            countParams.push(startTimestamp);
        }
        
        if (endTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets <= $${paramIndex}`;
            countDateFilter += ` AND ets <= $${paramIndex}`;
            queryParams.push(endTimestamp);
            countParams.push(endTimestamp);
        }
        
        // Add pagination params
        queryParams.push(limit, offset);
        
        // Get questions by user ID with pagination and date filtering
        const questionsQuery = {
            text: `
                SELECT 
                    id,
                    uid as qid,
                    questiontext AS question,
                    answertext AS answer,
                    uid AS user_id,
                    created_at,
                    ets,
                    channel,
                    sid AS session_id
                FROM questions
                WHERE uid = $1 
                    AND questiontext IS NOT NULL 
                    AND answertext IS NOT NULL
                    ${dateFilter}
                ORDER BY created_at DESC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `,
            values: queryParams,
        };
        
        // Get total count for user with date filtering
        const countQuery = {
            text: `
                SELECT COUNT(*) as total
                FROM questions
                WHERE uid = $1 
                    AND questiontext IS NOT NULL 
                    AND answertext IS NOT NULL
                    ${countDateFilter}
            `,
            values: countParams,
        };
        
        const [questionsResult, countResult] = await Promise.all([
            pool.query(questionsQuery),
            pool.query(countQuery)
        ]);
        
        const totalCount = parseInt(countResult.rows[0].total);
        const formattedData = questionsResult.rows.map(formatQuestionData);
        
        // Calculate pagination metadata
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPreviousPage = page > 1;
        
        res.status(200).json({
            success: true,
            data: formattedData,
            pagination: {
                currentPage: page,
                totalPages: totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: hasNextPage,
                hasPreviousPage: hasPreviousPage,
                nextPage: hasNextPage ? page + 1 : null,
                previousPage: hasPreviousPage ? page - 1 : null
            },
            filters: {
                userId: userId.trim(),
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching questions by user ID:", error);
        res.status(500).json({ 
            success: false,
            error: "Error fetching user questions" 
        });
    }
};

// Get questions by session ID with date filtering
const getQuestionsBySessionId = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        const offset = (page - 1) * limit;
        
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return res.status(400).json({ 
                success: false,
                error: "Valid Session ID is required" 
            });
        }
        
        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({ 
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp" 
            });
        }
        
        // Build date filtering for questions query
        let dateFilter = '';
        let countDateFilter = '';
        const queryParams = [sessionId.trim()];
        const countParams = [sessionId.trim()];
        let paramIndex = 1;
        
        if (startTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets >= $${paramIndex}`;
            countDateFilter += ` AND ets >= $${paramIndex}`;
            queryParams.push(startTimestamp);
            countParams.push(startTimestamp);
        }
        
        if (endTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets <= $${paramIndex}`;
            countDateFilter += ` AND ets <= $${paramIndex}`;
            queryParams.push(endTimestamp);
            countParams.push(endTimestamp);
        }
        
        // Add pagination params
        queryParams.push(limit, offset);
        
        // Get questions by session ID with pagination and date filtering
        const questionsQuery = {
            text: `
                SELECT 
                    id,
                    uid as qid,
                    questiontext AS question,
                    answertext AS answer,
                    uid AS user_id,
                    created_at,
                    ets,
                    channel,
                    sid AS session_id
                FROM questions
                WHERE sid = $1 
                    AND questiontext IS NOT NULL 
                    AND answertext IS NOT NULL
                    ${dateFilter}
                ORDER BY created_at DESC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `,
            values: queryParams,
        };
        
        // Get total count for session with date filtering
        const countQuery = {
            text: `
                SELECT COUNT(*) as total
                FROM questions
                WHERE sid = $1 
                    AND questiontext IS NOT NULL 
                    AND answertext IS NOT NULL
                    ${countDateFilter}
            `,
            values: countParams,
        };
        
        const [questionsResult, countResult] = await Promise.all([
            pool.query(questionsQuery),
            pool.query(countQuery)
        ]);
        
        const totalCount = parseInt(countResult.rows[0].total);
        const formattedData = questionsResult.rows.map(formatQuestionData);
        
        // Calculate pagination metadata
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPreviousPage = page > 1;
        
        res.status(200).json({
            success: true,
            data: formattedData,
            pagination: {
                currentPage: page,
                totalPages: totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: hasNextPage,
                hasPreviousPage: hasPreviousPage,
                nextPage: hasNextPage ? page + 1 : null,
                previousPage: hasPreviousPage ? page - 1 : null
            },
            filters: {
                sessionId: sessionId.trim(),
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching questions by session ID:", error);
        res.status(500).json({ 
            success: false,
            error: "Error fetching session questions" 
        });
    }
};

module.exports = {
    getQuestions,
    getQuestionById,
    getQuestionsByUserId,
    getQuestionsBySessionId,
    getTotalQuestionsCount,
    fetchQuestionsFromDB,
    formatQuestionData
};