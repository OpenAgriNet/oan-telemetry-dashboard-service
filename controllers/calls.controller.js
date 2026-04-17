const pool = require('../services/db');
const { parseDateRange } = require('../utils/dateUtils');

// ─── GET /calls ── paginated list with aggregated message counts ───
const getCalls = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const search = req.query.search ? String(req.query.search).trim() : '';
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        const sortBy = req.query.sortBy ? String(req.query.sortBy).trim() : null;
        const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
        const offset = (page - 1) * limit;

        // Validate search
        if (search.length > 1000) {
            return res.status(400).json({ success: false, error: 'Search term too long' });
        }

        // Build dynamic WHERE + params
        const conditions = [];
        const queryParams = [];
        let paramIdx = 0;

        // Date filtering (calls.start_datetime is a TIMESTAMP, not ETS)
        if (startDate || endDate) {
            const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
            if (startDate && startTimestamp === null) {
                return res.status(400).json({ success: false, error: 'Invalid startDate format' });
            }
            if (endDate && endTimestamp === null) {
                return res.status(400).json({ success: false, error: 'Invalid endDate format' });
            }
            if (startTimestamp && endTimestamp && startTimestamp > endTimestamp) {
                return res.status(400).json({ success: false, error: 'startDate cannot be after endDate' });
            }
            if (startTimestamp !== null) {
                paramIdx++;
                conditions.push(`c.start_datetime >= TO_TIMESTAMP($${paramIdx} / 1000.0)`);
                queryParams.push(startTimestamp);
            }
            if (endTimestamp !== null) {
                paramIdx++;
                conditions.push(`c.start_datetime <= TO_TIMESTAMP($${paramIdx} / 1000.0)`);
                queryParams.push(endTimestamp);
            }
        }

        // Search filtering
        if (search) {
            paramIdx++;
            const searchParam = `%${search}%`;
            conditions.push(`(
                c.interaction_id ILIKE $${paramIdx}
                OR c.user_contact_masked ILIKE $${paramIdx}
                OR c.language_name ILIKE $${paramIdx}
                OR c.end_reason ILIKE $${paramIdx}
                OR c.current_language ILIKE $${paramIdx}
            )`);
            queryParams.push(searchParam);
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // Allowed sort columns (whitelist to prevent SQL injection)
        const SORT_MAP = {
            start_datetime: 'c.start_datetime',
            duration: 'c.duration_in_seconds',
            duration_in_seconds: 'c.duration_in_seconds',
            questions_count: 'questions_count',
            total_interactions: 'total_interactions',
            language_name: 'c.language_name',
            num_messages: 'c.num_messages',
            end_reason: 'c.end_reason',
        };
        const orderColumn = SORT_MAP[sortBy] || 'c.start_datetime';
        const orderClause = `ORDER BY ${orderColumn} ${sortOrder} NULLS LAST`;

        // ── Data query: join calls ← messages to compute questions + interactions ──
        paramIdx++;
        const limitParam = paramIdx;
        queryParams.push(limit);
        paramIdx++;
        const offsetParam = paramIdx;
        queryParams.push(offset);

        const dataQuery = `
            SELECT
                c.id,
                c.interaction_id,
                c.user_id,
                c.user_contact_masked,
                c.connectivity_status,
                c.failure_reason,
                c.end_reason,
                c.duration_in_seconds,
                to_char(c.start_datetime, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS start_datetime,
                to_char(c.end_datetime, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS end_datetime,
                c.language_name,
                c.current_language,
                c.num_messages,
                c.average_agent_response_time_in_seconds,
                c.average_user_response_time_in_seconds,
                c.channel_direction,
                c.channel_provider,
                c.channel_type,
                c.retry_attempt,
                c.is_debug_call,
                c.audio_url,
                c.has_log_issues,
                COUNT(m.id)                                      AS total_interactions,
                COUNT(m.id) FILTER (WHERE m.role = 'user')       AS questions_count
            FROM calls c
            LEFT JOIN messages m ON m.call_id = c.id
            ${whereClause}
            GROUP BY c.id
            ${orderClause}
            LIMIT $${limitParam} OFFSET $${offsetParam}
        `;

        // ── Count query (same WHERE, no join needed for count) ──
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM calls c
            ${whereClause}
        `;
        // Count query uses only the filter params (not limit/offset)
        const countParams = queryParams.slice(0, queryParams.length - 2);

        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, queryParams),
            pool.query(countQuery, countParams),
        ]);

        const totalCount = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(totalCount / limit);

        const data = dataResult.rows.map(formatCallRow);

        res.status(200).json({
            success: true,
            data,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
                nextPage: page < totalPages ? page + 1 : null,
                previousPage: page > 1 ? page - 1 : null,
            },
            filters: { search, startDate, endDate },
        });
    } catch (error) {
        console.error('Error fetching calls:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// ─── GET /calls/stats ── aggregate stats for header cards ───
const getCallsStats = async (req, res) => {
    try {
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

        const conditions = [];
        const queryParams = [];
        let paramIdx = 0;

        if (startDate || endDate) {
            const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
            if (startTimestamp !== null) {
                paramIdx++;
                conditions.push(`c.start_datetime >= TO_TIMESTAMP($${paramIdx} / 1000.0)`);
                queryParams.push(startTimestamp);
            }
            if (endTimestamp !== null) {
                paramIdx++;
                conditions.push(`c.start_datetime <= TO_TIMESTAMP($${paramIdx} / 1000.0)`);
                queryParams.push(endTimestamp);
            }
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        const query = `
            SELECT
                COUNT(DISTINCT c.id)                                     AS total_calls,
                COUNT(DISTINCT NULLIF(TRIM(c.user_id), ''))              AS total_users,
                COALESCE(SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0)   AS total_questions,
                COALESCE(COUNT(m.id), 0)                                         AS total_interactions,
                ROUND(AVG(c.duration_in_seconds)::NUMERIC, 2)                    AS avg_duration
            FROM calls c
            LEFT JOIN messages m ON m.call_id = c.id
            ${whereClause}
        `;

        const result = await pool.query(query, queryParams);
        const stats = result.rows[0];

        res.status(200).json({
            success: true,
            data: {
                totalCalls: parseInt(stats.total_calls) || 0,
                totalUsers: parseInt(stats.total_users) || 0,
                totalQuestions: parseInt(stats.total_questions) || 0,
                totalInteractions: parseInt(stats.total_interactions) || 0,
                avgDuration: parseFloat(stats.avg_duration) || 0,
            },
            filters: { startDate, endDate },
        });
    } catch (error) {
        console.error('Error fetching calls stats:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// ─── GET /calls/:callId ── single call + all messages ───
const getCallById = async (req, res) => {
    try {
        const { callId } = req.params;
        // For wildcard route, use req.params[0]; fall back to callId for named param
        const rawId = req.params[0] || callId;

        if (!rawId || rawId.trim() === '') {
            return res.status(400).json({ success: false, error: 'Valid Call ID (interaction_id) is required' });
        }

        const interactionId = rawId.trim();

        // Fetch call metadata + aggregated counts
        const callQuery = `
            SELECT
                c.id,
                c.interaction_id,
                c.user_id,
                c.user_contact_masked,
                c.connectivity_status,
                c.failure_reason,
                c.end_reason,
                c.duration_in_seconds,
                to_char(c.start_datetime, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS start_datetime,
                to_char(c.end_datetime, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS end_datetime,
                c.language_name,
                c.current_language,
                c.num_messages,
                c.average_agent_response_time_in_seconds,
                c.average_user_response_time_in_seconds,
                c.channel_direction,
                c.channel_provider,
                c.channel_type,
                c.retry_attempt,
                c.is_debug_call,
                c.audio_url,
                c.has_log_issues,
                COUNT(m.id)                                    AS total_interactions,
                COUNT(m.id) FILTER (WHERE m.role = 'user')     AS questions_count
            FROM calls c
            LEFT JOIN messages m ON m.call_id = c.id
            WHERE c.interaction_id = $1
            GROUP BY c.id
        `;
        const callResult = await pool.query(callQuery, [interactionId]);

        if (callResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Call not found' });
        }

        // Fetch ordered messages
        const messagesQuery = `
            SELECT m.id, m.role, m.content, m.message_order
            FROM messages m
            JOIN calls c ON c.id = m.call_id
            WHERE c.interaction_id = $1
            ORDER BY m.message_order ASC
        `;
        const messagesResult = await pool.query(messagesQuery, [interactionId]);

        const call = formatCallRow(callResult.rows[0]);
        const messages = messagesResult.rows.map(row => ({
            id: row.id,
            role: row.role,
            content: row.content,
            messageOrder: row.message_order,
        }));

        res.status(200).json({
            success: true,
            data: { call, messages },
        });
    } catch (error) {
        console.error('Error fetching call by ID:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// ─── Helper: format a DB row into a clean API response ───
function formatCallRow(row) {
    return {
        id: row.id,
        interactionId: row.interaction_id,
        userId: row.user_id,
        userContactMasked: row.user_contact_masked,
        connectivityStatus: row.connectivity_status,
        failureReason: row.failure_reason,
        endReason: row.end_reason,
        durationInSeconds: row.duration_in_seconds ? parseFloat(row.duration_in_seconds) : null,
        startDatetime: row.start_datetime,
        endDatetime: row.end_datetime,
        languageName: row.language_name,
        currentLanguage: row.current_language,
        numMessages: row.num_messages ? parseInt(row.num_messages) : 0,
        averageAgentResponseTime: row.average_agent_response_time_in_seconds
            ? parseFloat(row.average_agent_response_time_in_seconds)
            : null,
        averageUserResponseTime: row.average_user_response_time_in_seconds
            ? parseFloat(row.average_user_response_time_in_seconds)
            : null,
        channelDirection: row.channel_direction,
        channelProvider: row.channel_provider,
        channelType: row.channel_type,
        retryAttempt: row.retry_attempt ? parseInt(row.retry_attempt) : 0,
        isDebugCall: row.is_debug_call || false,
        audioUrl: row.audio_url,
        hasLogIssues: row.has_log_issues || false,
        questionsCount: row.questions_count ? parseInt(row.questions_count) : 0,
        totalInteractions: row.total_interactions ? parseInt(row.total_interactions) : 0,
    };
}

module.exports = {
    getCalls,
    getCallById,
    getCallsStats,
};
