const pool = require('../services/db');
const { parseDateRange } = require('../utils/dateUtils');
const { mvExists } = require('../utils/mvHealth');

// ─── GET /calls ── paginated list driven off mv_call_message_counts when available ───
//
// Old path did  SELECT ... FROM calls c LEFT JOIN messages m ON m.call_id = c.id
//              WHERE ... GROUP BY c.id ORDER BY c.start_datetime DESC LIMIT N OFFSET M
// which scanned calls×messages every page (≈19s on production volume).
//
// New path drives off mv_call_message_counts which pre-aggregates total_interactions
// and questions_count per call, then joins back to calls for the 20 rows on the page.
// Count comes from mv_calls_daily_counts when date range is supplied.
//
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

        if (search.length > 1000) {
            return res.status(400).json({ success: false, error: 'Search term too long' });
        }

        // Validate date range params
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

        const hasCallMessageCountsMV = await mvExists('mv_call_message_counts');
        const hasCallsDailyCountsMV = await mvExists('mv_calls_daily_counts');

        let dataResult;
        let countResult;
        let dataSource = 'base';
        let countSource = 'base';

        if (hasCallMessageCountsMV) {
            try {
                const { rows } = await runMvBackedList({
                    startTimestamp,
                    endTimestamp,
                    search,
                    sortBy,
                    sortOrder,
                    limit,
                    offset,
                });
                dataResult = rows;
                dataSource = 'mv';
            } catch (mvErr) {
                // search forces base path, and any other MV failure is logged.
                if (mvErr && !String(mvErr.message).includes('search forces')) {
                    console.warn('[Calls] MV list query failed, falling back:', mvErr.message);
                }
            }
        }

        if (!dataResult) {
            dataResult = await runBaseList({
                startTimestamp,
                endTimestamp,
                search,
                sortBy,
                sortOrder,
                limit,
                offset,
            });
        }

        // --- Count -----------------------------------------------------------
        // When we have date range + no search, count via mv_calls_daily_counts.
        // When search is active we fall back to the base count (still cheap
        // now with trigram indexes) so search results get the right total.
        const dateOnly = (startTimestamp && endTimestamp) && !search;
        if (hasCallsDailyCountsMV && dateOnly) {
            try {
                const res = await pool.query(
                    `SELECT COALESCE(SUM(call_count), 0)::bigint AS total
                     FROM mv_calls_daily_counts
                     WHERE call_date >= DATE($1 AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
                       AND call_date <= DATE($2 AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')`,
                    [new Date(startTimestamp), new Date(endTimestamp)]
                );
                countResult = parseInt(res.rows[0].total, 10) || 0;
                countSource = 'mv';
            } catch (mvErr) {
                console.warn('[Calls] MV count query failed, falling back:', mvErr.message);
            }
        }

        if (countResult == null) {
            countResult = await runBaseCount({ startTimestamp, endTimestamp, search });
        }

        const totalCount = countResult;
        const totalPages = Math.ceil(totalCount / limit);
        const data = dataResult.map(formatCallRow);

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
            meta: {
                source: dataSource,
                countSource,
            },
        });
    } catch (error) {
        console.error('Error fetching calls:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Allowed sort columns whitelist. Maps external name -> expression on the outer select.
// `start_date` alias kept because the frontend uses it.
const SORT_MAP = {
    start_datetime: 'c.start_datetime',
    start_date: 'c.start_datetime',
    duration: 'duration_in_seconds',
    duration_in_seconds: 'duration_in_seconds',
    questions_count: 'questions_count',
    total_interactions: 'total_interactions',
    language_name: 'c.language_name',
    num_messages: 'c.num_messages',
    end_reason: 'c.end_reason',
};

// MV-backed listing: LIMIT is applied *before* JOIN back to calls so we
// touch at most `limit` rows of the big calls table.
async function runMvBackedList({ startTimestamp, endTimestamp, search, sortBy, sortOrder, limit, offset }) {
    const conditions = [];
    const params = [];
    let idx = 0;

    if (startTimestamp !== null) {
        idx++;
        conditions.push(`mv.start_datetime >= TO_TIMESTAMP($${idx} / 1000.0)`);
        params.push(startTimestamp);
    }
    if (endTimestamp !== null) {
        idx++;
        conditions.push(`mv.start_datetime <= TO_TIMESTAMP($${idx} / 1000.0)`);
        params.push(endTimestamp);
    }
    // Search is applied inside the JOIN-back subquery (against c.*). If search
    // is supplied we can't meaningfully limit first; fall back to the base path.
    if (search) {
        // Force base path for search-based queries.
        throw new Error('search forces base path');
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const orderMap = {
        start_datetime: 'mv.start_datetime',
        start_date: 'mv.start_datetime',
        duration: 'mv.duration_in_seconds',
        duration_in_seconds: 'mv.duration_in_seconds',
        questions_count: 'mv.questions_count',
        total_interactions: 'mv.total_interactions',
        language_name: 'mv.language_name',
        end_reason: 'mv.end_reason',
    };
    // Inner (CTE) ORDER BY refers to mv.*; outer ORDER BY must reuse the same
    // sort key but pointing at the joined rows.
    const innerOrderColumn = orderMap[sortBy] || 'mv.start_datetime';
    const innerOrderClause = `ORDER BY ${innerOrderColumn} ${sortOrder} NULLS LAST`;

    const outerOrderMap = {
        'mv.start_datetime': 'c.start_datetime',
        'mv.duration_in_seconds': 'p.duration_in_seconds',
        'mv.questions_count': 'p.questions_count',
        'mv.total_interactions': 'p.total_interactions',
        'mv.language_name': 'c.language_name',
        'mv.end_reason': 'c.end_reason',
    };
    const outerOrderColumn = outerOrderMap[innerOrderColumn] || 'c.start_datetime';
    const outerOrderClause = `ORDER BY ${outerOrderColumn} ${sortOrder} NULLS LAST`;

    idx++;
    const limitParam = idx;
    params.push(limit);
    idx++;
    const offsetParam = idx;
    params.push(offset);

    // Step 1: pick the page's N ids from the MV.
    // Step 2: join back to calls for all the metadata columns the UI needs.
    const sql = `
        WITH page_ids AS (
            SELECT mv.id,
                   mv.total_interactions,
                   mv.questions_count,
                   mv.duration_in_seconds
            FROM mv_call_message_counts mv
            ${whereClause}
            ${innerOrderClause}
            LIMIT $${limitParam} OFFSET $${offsetParam}
        )
        SELECT
            c.id,
            c.interaction_id,
            c.user_id,
            c.user_contact_masked,
            c.connectivity_status,
            c.failure_reason,
            c.end_reason,
            COALESCE(NULLIF(c.duration_in_seconds, 0), EXTRACT(EPOCH FROM (c.end_datetime - c.start_datetime))) AS duration_in_seconds,
            to_char(c.start_datetime AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS start_datetime,
            to_char(c.end_datetime   AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS end_datetime,
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
            p.total_interactions,
            p.questions_count
        FROM page_ids p
        JOIN calls c ON c.id = p.id
        ${outerOrderClause}
    `;

    const { rows } = await pool.query(sql, params);
    return { rows, orderClause: outerOrderClause };
}

// Base path: live JOIN to messages. Used when search is active or MV is missing.
async function runBaseList({ startTimestamp, endTimestamp, search, sortBy, sortOrder, limit, offset }) {
    const conditions = [];
    const params = [];
    let idx = 0;

    if (startTimestamp !== null) {
        idx++;
        conditions.push(`c.start_datetime >= TO_TIMESTAMP($${idx} / 1000.0)`);
        params.push(startTimestamp);
    }
    if (endTimestamp !== null) {
        idx++;
        conditions.push(`c.start_datetime <= TO_TIMESTAMP($${idx} / 1000.0)`);
        params.push(endTimestamp);
    }
    if (search) {
        idx++;
        const s = `%${search}%`;
        conditions.push(`(
            c.interaction_id ILIKE $${idx}
            OR c.user_contact_masked ILIKE $${idx}
            OR c.language_name ILIKE $${idx}
            OR c.end_reason ILIKE $${idx}
            OR c.current_language ILIKE $${idx}
        )`);
        params.push(s);
    }
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const orderColumn = SORT_MAP[sortBy] || 'c.start_datetime';
    const orderClause = `ORDER BY ${orderColumn} ${sortOrder} NULLS LAST`;

    idx++;
    const limitParam = idx;
    params.push(limit);
    idx++;
    const offsetParam = idx;
    params.push(offset);

    const sql = `
        SELECT
            c.id,
            c.interaction_id,
            c.user_id,
            c.user_contact_masked,
            c.connectivity_status,
            c.failure_reason,
            c.end_reason,
            COALESCE(NULLIF(c.duration_in_seconds, 0), EXTRACT(EPOCH FROM (c.end_datetime - c.start_datetime))) AS duration_in_seconds,
            to_char(c.start_datetime AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS start_datetime,
            to_char(c.end_datetime   AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS end_datetime,
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
            COUNT(m.id)                                AS total_interactions,
            COUNT(m.id) FILTER (WHERE m.role = 'user') AS questions_count
        FROM calls c
        LEFT JOIN messages m ON m.call_id = c.id
        ${whereClause}
        GROUP BY c.id
        ${orderClause}
        LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
    const { rows } = await pool.query(sql, params);
    return rows;
}

// Base count path: used when search is active, date range absent, or
// MV fallback required.
async function runBaseCount({ startTimestamp, endTimestamp, search }) {
    const conditions = [];
    const params = [];
    let idx = 0;
    if (startTimestamp !== null) {
        idx++;
        conditions.push(`c.start_datetime >= TO_TIMESTAMP($${idx} / 1000.0)`);
        params.push(startTimestamp);
    }
    if (endTimestamp !== null) {
        idx++;
        conditions.push(`c.start_datetime <= TO_TIMESTAMP($${idx} / 1000.0)`);
        params.push(endTimestamp);
    }
    if (search) {
        idx++;
        const s = `%${search}%`;
        conditions.push(`(
            c.interaction_id ILIKE $${idx}
            OR c.user_contact_masked ILIKE $${idx}
            OR c.language_name ILIKE $${idx}
            OR c.end_reason ILIKE $${idx}
            OR c.current_language ILIKE $${idx}
        )`);
        params.push(s);
    }
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await pool.query(
        `SELECT COUNT(*)::bigint AS total FROM calls c ${whereClause}`,
        params
    );
    return parseInt(rows[0].total, 10) || 0;
}

// ─── GET /calls/stats ── aggregate stats for header cards ───
// Uses mv_call_message_counts when available.
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
                conditions.push(`start_datetime >= TO_TIMESTAMP($${paramIdx} / 1000.0)`);
                queryParams.push(startTimestamp);
            }
            if (endTimestamp !== null) {
                paramIdx++;
                conditions.push(`start_datetime <= TO_TIMESTAMP($${paramIdx} / 1000.0)`);
                queryParams.push(endTimestamp);
            }
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        const hasCallMessageCountsMV = await mvExists('mv_call_message_counts');

        let stats;
        let querySource = 'base';

        if (hasCallMessageCountsMV) {
            try {
                const mvQuery = `
                    SELECT
                        COUNT(*) AS total_calls,
                        COUNT(DISTINCT NULLIF(TRIM(user_id), '')) AS total_users,
                        SUM(questions_count) AS total_questions,
                        SUM(total_interactions) AS total_interactions,
                        ROUND(AVG(duration_in_seconds)::NUMERIC, 2) AS avg_duration
                    FROM mv_call_message_counts
                    ${whereClause}
                `;
                const mvResult = await pool.query(mvQuery, queryParams);
                if (mvResult.rows.length > 0) {
                    stats = mvResult.rows[0];
                    querySource = 'mv';
                }
            } catch (mvErr) {
                console.warn('[CallsStats] MV query failed, falling back to base query:', mvErr.message);
            }
        }

        if (!stats) {
            const fallbackQuery = `
                SELECT
                    COUNT(DISTINCT c.id)                                     AS total_calls,
                    COUNT(DISTINCT NULLIF(TRIM(c.user_id), ''))              AS total_users,
                    COALESCE(SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0)   AS total_questions,
                    COALESCE(COUNT(m.id), 0)                                         AS total_interactions,
                    ROUND(AVG(c.duration_in_seconds)::NUMERIC, 2)                    AS avg_duration
                FROM calls c
                LEFT JOIN messages m ON m.call_id = c.id
                ${whereClause.replace(/start_datetime/g, 'c.start_datetime')}
            `;
            const result = await pool.query(fallbackQuery, queryParams);
            stats = result.rows[0];
        }

        res.status(200).json({
            success: true,
            data: {
                totalCalls: parseInt(stats.total_calls) || 0,
                totalUsers: parseInt(stats.total_users) || 0,
                totalQuestions: parseInt(stats.total_questions) || 0,
                totalInteractions: parseInt(stats.total_interactions) || 0,
                avgDuration: parseFloat(stats.avg_duration) || 0,
            },
            meta: { source: querySource },
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
        const rawId = req.params[0] || callId;

        if (!rawId || rawId.trim() === '') {
            return res.status(400).json({ success: false, error: 'Valid Call ID (interaction_id) is required' });
        }

        const interactionId = rawId.trim();

        const callQuery = `
            SELECT
                c.id,
                c.interaction_id,
                c.user_id,
                c.user_contact_masked,
                c.connectivity_status,
                c.failure_reason,
                c.end_reason,
                COALESCE(NULLIF(c.duration_in_seconds, 0), EXTRACT(EPOCH FROM (c.end_datetime - c.start_datetime))) AS duration_in_seconds,
                to_char(c.start_datetime AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS start_datetime,
                to_char(c.end_datetime AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS end_datetime,
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

        res.status(200).json({ success: true, data: { call, messages } });
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
        durationInSeconds: row.duration_in_seconds != null ? parseFloat(row.duration_in_seconds) : null,
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
