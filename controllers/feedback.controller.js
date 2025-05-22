const pool = require('../services/db');

async function fetchAllFeedbackFromDB(page = 1, limit = 10, search = '') {
    const offset = (page - 1) * limit;
    
    // Base query with optional search - using parameterized queries
    let query = `
        SELECT 
            id,
            qid,
            uid as user_id,
            created_at,
            feedbacktype,   
            feedbacktext,
            questiontext,
            answertext,
            channel,
            sid as session_id
        FROM feedback
        WHERE feedbacktext IS NOT NULL AND questiontext IS NOT NULL
    `;
    
    const queryParams = [];
    
    // Add search functionality if search term is provided
    if (search && search.trim() !== '') {
        query += ` AND (
            feedbacktext ILIKE $1 OR 
            questiontext ILIKE $1 OR 
            answertext ILIKE $1
        )`;
        queryParams.push(`%${search.trim()}%`);
        
        query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
        queryParams.push(limit, offset);
    } else {
        query += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
        queryParams.push(limit, offset);
    }

    const result = await pool.query(query, queryParams);
    return result.rows;
}

async function getTotalFeedbackCount(search = '') {
    let query = `
        SELECT COUNT(*) as total
        FROM feedback
        WHERE feedbacktext IS NOT NULL AND questiontext IS NOT NULL
    `;
    
    const queryParams = [];
    
    // Add search filter to count query if search term is provided
    if (search && search.trim() !== '') {
        query += ` AND (
            feedbacktext ILIKE $1 OR 
            questiontext ILIKE $1 OR 
            answertext ILIKE $1
        )`;
        queryParams.push(`%${search.trim()}%`);
    }
    
    const result = await pool.query(query, queryParams);
    return parseInt(result.rows[0].total);
}
    
function formatFeedbackData(feedbackItem) {
    const dateObj = new Date(feedbackItem.created_at);
    const formattedDate = dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });

    return {
        qid: feedbackItem.qid,
        date: formattedDate,
        user: feedbackItem.user_id,
        question: feedbackItem.questiontext,
        sessionId: feedbackItem.session_id,
        answer: feedbackItem.answertext.substring(0, 100) + "...",
        rating: feedbackItem.feedbacktype,
        feedback: feedbackItem.feedbacktext,
        id: feedbackItem.id,
    };
}

// Controller function to get all feedback with pagination
async function getAllFeedback(req, res) {
    try {
        // Extract and sanitize pagination parameters from query string
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const search = req.query.search ? String(req.query.search).trim() : '';
        
        // Additional validation for search term length to prevent abuse
        if (search.length > 1000) {
            return res.status(400).json({ message: "Search term too long" });
        }

        // Fetch paginated feedback data and total count
        const [rawFeedbackData, totalCount] = await Promise.all([
            fetchAllFeedbackFromDB(page, limit, search),
            getTotalFeedbackCount(search)
        ]);

        const formattedFeedback = rawFeedbackData.map(formatFeedbackData);
        
        // Calculate pagination metadata
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPreviousPage = page > 1;

        // Return paginated response
        res.status(200).json({
            data: formattedFeedback,
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
        console.error("Error fetching feedback:", error);
        res.status(500).json({ message: "Error fetching feedback data" });
    }
}

// New function to fetch feedback by QID from the database
async function fetchFeedbackByidFromDB(id) {
    const query = {
        text: `
            SELECT 
                id,
                uid AS user_id,
                sid AS session_id,
                groupdetails,
                channel,
                ets,
                feedbacktext,
                questiontext,
                answertext,
                feedbacktype,
                created_at,
                qid AS question_id
            FROM feedback
            WHERE id = $1
        `,
        values: [id],
    };
    const result = await pool.query(query);
    return result.rows;
}

// Controller function to get feedback by ID with proper validation
async function getFeedbackByid(req, res) {
    try {
        const { id } = req.params;
        
        // Validate UUID format to prevent SQL injection
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        
        if (!id || !uuidRegex.test(id)) {
            return res.status(400).json({ message: "Valid UUID ID is required" });
        }
        
        const feedbackDetails = await fetchFeedbackByidFromDB(id);
        
        if (feedbackDetails.length === 0) {
            return res.status(404).json({ message: "No feedback found for the given ID" });
        }
        
        res.status(200).json(feedbackDetails);
    } catch (error) {
        console.error("Error fetching feedback by ID:", error);
        res.status(500).json({ message: "Error fetching feedback data" });
    }
}

module.exports = {
    getAllFeedback,
    getFeedbackByid,
};