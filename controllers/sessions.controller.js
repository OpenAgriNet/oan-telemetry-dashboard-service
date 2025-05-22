const pool = require('../services/db');

async function fetchSessionsFromDB(page = 1, limit = 10, search = '') {
    const offset = (page - 1) * limit;
    
    // Base CTE query with optional search - using parameterized queries
    let query = `
        WITH combined_sessions AS (
            SELECT 
                sid,
                uid,
                questiontext,
                ets
            FROM questions
            WHERE sid IS NOT NULL
            UNION ALL
            SELECT 
                sid,
                uid,
                NULL as questiontext,
                ets
            FROM feedback
            WHERE sid IS NOT NULL
            UNION ALL
            SELECT 
                sid,
                uid,
                NULL as questiontext,
                ets
            FROM errordetails
            WHERE sid IS NOT NULL
        )
        SELECT 
            sid as session_id,
            uid as username,
            COUNT(questiontext) as question_count,
            MAX(ets) as session_time
        FROM combined_sessions
        GROUP BY sid, uid
    `;
    
    const queryParams = [];
    
    // Add search functionality if search term is provided
    if (search && search.trim() !== '') {
        query += ` HAVING (
            sid ILIKE $1 OR 
            uid ILIKE $1
        )`;
        queryParams.push(`%${search.trim()}%`);
        
        query += ` ORDER BY session_time DESC LIMIT $2 OFFSET $3`;
        queryParams.push(limit, offset);
    } else {
        query += ` ORDER BY session_time DESC LIMIT $1 OFFSET $2`;
        queryParams.push(limit, offset);
    }

    const result = await pool.query(query, queryParams);
    return result.rows;
}

async function getTotalSessionsCount(search = '') {
    let query = `
        WITH combined_sessions AS (
            SELECT 
                sid,
                uid,
                questiontext,
                ets
            FROM questions
            WHERE sid IS NOT NULL
            UNION ALL
            SELECT 
                sid,
                uid,
                NULL as questiontext,
                ets
            FROM feedback
            WHERE sid IS NOT NULL
            UNION ALL
            SELECT 
                sid,
                uid,
                NULL as questiontext,
                ets
            FROM errordetails
            WHERE sid IS NOT NULL
        ),
        session_groups AS (
            SELECT 
                sid,
                uid,
                COUNT(questiontext) as question_count,
                MAX(ets) as session_time
            FROM combined_sessions
            GROUP BY sid, uid
        )
        SELECT COUNT(*) as total
        FROM session_groups
    `;
    
    const queryParams = [];
    
    // Add search filter to count query if search term is provided
    if (search && search.trim() !== '') {
        query += ` WHERE (
            sid ILIKE $1 OR 
            uid ILIKE $1
        )`;
        queryParams.push(`%${search.trim()}%`);
    }
    
    const result = await pool.query(query, queryParams);
    return parseInt(result.rows[0].total);
}

function formatSessionData(row) {
    let sessionTime = null;
    
    try {
        if (row.session_time) {
            // First try to parse the timestamp if it's in milliseconds
            const timestamp = parseInt(row.session_time);
            if (!isNaN(timestamp)) {
                sessionTime = new Date(timestamp).toISOString().slice(0, 19);
            } else {
                // If not a timestamp, try parsing as a date string
                sessionTime = new Date(row.session_time).toISOString().slice(0, 19);
            }
        }
    } catch (err) {
        console.warn('Could not parse date:', row.session_time);
        sessionTime = null;
    }

    return {
        sessionId: row.session_id,
        username: row.username,
        questionCount: parseInt(row.question_count) || 0,
        sessionTime
    };
}

const getSessions = async (req, res) => {
    try {
        console.log('Fetching sessions...');
        
        // Extract and sanitize pagination parameters from query string
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const search = req.query.search ? String(req.query.search).trim() : '';
        
        // Additional validation for search term length to prevent abuse
        if (search.length > 1000) {
            return res.status(400).json({ 
                success: false,
                error: "Search term too long" 
            });
        }

        // Fetch paginated sessions data and total count
        const [sessionsData, totalCount] = await Promise.all([
            fetchSessionsFromDB(page, limit, search),
            getTotalSessionsCount(search)
        ]);

        console.log('Query result:', sessionsData.length, 'sessions found for page', page);

        const formattedData = sessionsData.map(formatSessionData);
        
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
            search: search
        });
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

// Get single session details by session ID
const getSessionById = async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            return res.status(400).json({ 
                success: false,
                error: "Valid Session ID is required" 
            });
        }
        
        // Get session details with all related data
        const query = {
            text: `
                WITH session_questions AS (
                    SELECT 
                        id,
                        uid,
                        sid,
                        questiontext,
                        answertext,
                        ets,
                        created_at,
                        channel,
                        'question' as type
                    FROM questions
                    WHERE sid = $1
                ),
                session_feedback AS (
                    SELECT 
                        id,
                        uid,
                        sid,
                        feedbacktext as content,
                        feedbacktype,
                        ets,
                        created_at,
                        channel,
                        'feedback' as type
                    FROM feedback
                    WHERE sid = $1
                ),
                session_errors AS (
                    SELECT 
                        id,
                        uid,
                        sid,
                        NULL as content,
                        NULL as feedbacktype,
                        ets,
                        created_at,
                        NULL as channel,
                        'error' as type
                    FROM errordetails
                    WHERE sid = $1
                )
                SELECT * FROM session_questions
                UNION ALL
                SELECT 
                    id, uid, sid, content, feedbacktype, ets, created_at, channel, type
                FROM session_feedback
                UNION ALL
                SELECT 
                    id, uid, sid, content, feedbacktype, ets, created_at, channel, type
                FROM session_errors
                ORDER BY ets DESC, created_at DESC
            `,
            values: [sessionId.trim()],
        };
        
        const result = await pool.query(query);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: "No session found for the given ID" 
            });
        }
        
        // Group data by type and format
        const sessionData = {
            sessionId: sessionId.trim(),
            username: result.rows[0].uid,
            questions: [],
            feedback: [],
            errors: [],
            totalItems: result.rows.length
        };
        
        result.rows.forEach(row => {
            const formattedRow = {
                id: row.id,
                timestamp: row.ets,
                createdAt: row.created_at,
                channel: row.channel
            };
            
            if (row.type === 'question') {
                sessionData.questions.push({
                    ...formattedRow,
                    questionText: row.questiontext,
                    answerText: row.answertext
                });
            } else if (row.type === 'feedback') {
                sessionData.feedback.push({
                    ...formattedRow,
                    feedbackText: row.content,
                    feedbackType: row.feedbacktype
                });
            } else if (row.type === 'error') {
                sessionData.errors.push(formattedRow);
            }
        });
        
        res.status(200).json({
            success: true,
            data: sessionData
        });
    } catch (error) {
        console.error("Error fetching session by ID:", error);
        res.status(500).json({ 
            success: false,
            error: "Error fetching session data" 
        });
    }
};

// Get sessions by user ID
const getSessionsByUserId = async (req, res) => {
    try {
        const { userId } = req.params;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const offset = (page - 1) * limit;
        
        if (!userId || typeof userId !== 'string' || userId.trim() === '') {
            return res.status(400).json({ 
                success: false,
                error: "Valid User ID is required" 
            });
        }
        
        // Get sessions by user ID with pagination
        const sessionsQuery = {
            text: `
                WITH combined_sessions AS (
                    SELECT 
                        sid,
                        uid,
                        questiontext,
                        ets
                    FROM questions
                    WHERE sid IS NOT NULL AND uid = $1
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM feedback
                    WHERE sid IS NOT NULL AND uid = $1
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM errordetails
                    WHERE sid IS NOT NULL AND uid = $1
                )
                SELECT 
                    sid as session_id,
                    uid as username,
                    COUNT(questiontext) as question_count,
                    MAX(ets) as session_time
                FROM combined_sessions
                GROUP BY sid, uid
                ORDER BY session_time DESC
                LIMIT $2 OFFSET $3
            `,
            values: [userId.trim(), limit, offset],
        };
        
        // Get total count for user
        const countQuery = {
            text: `
                WITH combined_sessions AS (
                    SELECT 
                        sid,
                        uid,
                        questiontext,
                        ets
                    FROM questions
                    WHERE sid IS NOT NULL AND uid = $1
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM feedback
                    WHERE sid IS NOT NULL AND uid = $1
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM errordetails
                    WHERE sid IS NOT NULL AND uid = $1
                )
                SELECT COUNT(DISTINCT sid) as total
                FROM combined_sessions
            `,
            values: [userId.trim()],
        };
        
        const [sessionsResult, countResult] = await Promise.all([
            pool.query(sessionsQuery),
            pool.query(countQuery)
        ]);
        
        const totalCount = parseInt(countResult.rows[0].total);
        const formattedData = sessionsResult.rows.map(formatSessionData);
        
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
            userId: userId.trim()
        });
    } catch (error) {
        console.error("Error fetching sessions by user ID:", error);
        res.status(500).json({ 
            success: false,
            error: "Error fetching user sessions" 
        });
    }
};

module.exports = {
    getSessions,
    getSessionById,
    getSessionsByUserId
};