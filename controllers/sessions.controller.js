const pool = require('../services/db');
const { parseDateRange, formatDateToIST, getCurrentTimestamp } = require('../utils/dateUtils');
const { mvExists } = require('../utils/mvHealth');
const { buildChannelFilterClause } = require('../utils/stateAccess');
const { epochMsDateTruncIst } = require('../utils/istSql');

async function fetchSessionsFromDB(page = 1, limit = 10, search = '', startDate = null, endDate = null, sortBy = null, sortOrder = 'DESC', pagination = true, telemetryState = null) {
    const offset = (page - 1) * limit;
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

    // Try MV-first path: mv_sessions_daily has one row per
    // (channel, sid, uid) session with pre-computed last_ets + question_count,
    // so no UNION is needed.
    if (await mvExists('mv_sessions_daily')) {
        try {
            const params = [];
            let idx = 0;
            const conditions = [];

            if (startTimestamp !== null) {
                idx++;
                conditions.push(`last_ets >= $${idx}`);
                params.push(startTimestamp);
            }
            if (endTimestamp !== null) {
                idx++;
                conditions.push(`last_ets <= $${idx}`);
                params.push(endTimestamp);
            }
            if (search && search.trim() !== '') {
                idx++;
                conditions.push(`(sid ILIKE $${idx} OR uid ILIKE $${idx})`);
                params.push(`%${search.trim()}%`);
            }

            const {
                clause: mvChannelClause,
                paramIndex: mvChannelParamIndex,
            } = buildChannelFilterClause('channel', telemetryState, params, idx);
            idx = mvChannelParamIndex;
            conditions.push(mvChannelClause);

            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
            const sortArray = ["question_count", "username", "session_id", "session_time"];
            let orderBy;
            if (sortArray.includes(sortBy)) {
                const col = ({
                    question_count: 'question_count',
                    username: 'uid',
                    session_id: 'sid',
                    session_time: 'last_ets',
                })[sortBy];
                orderBy = `ORDER BY ${col} ${sortOrder}`;
            } else {
                orderBy = 'ORDER BY last_ets DESC';
            }

            let paginationSql = '';
            if (pagination) {
                idx++;
                paginationSql = ` LIMIT $${idx}`;
                params.push(limit);
                idx++;
                paginationSql += ` OFFSET $${idx}`;
                params.push(offset);
            }

            const sql = `
                SELECT
                  sid AS session_id,
                  uid AS username,
                  question_count,
                  last_ets AS session_time
                FROM mv_sessions_daily
                ${where}
                ${orderBy}
                ${paginationSql}
            `;
            const result = await pool.query(sql, params);
            return result.rows;
        } catch (mvErr) {
            console.warn('[Sessions] MV list query failed, falling back:', mvErr.message);
        }
    }

    // Fallback: legacy 3-table UNION ALL.
    let dateConditions = '';
    const queryParams = [];
    let paramIndex = 0;

    const {
        clause: channelClause,
        paramIndex: channelParamIndex,
    } = buildChannelFilterClause("channel", telemetryState, queryParams, paramIndex);
    paramIndex = channelParamIndex;

    if (startTimestamp !== null) {
        paramIndex++;
        dateConditions += ` AND ets >= $${paramIndex}`;
        queryParams.push(startTimestamp);
    }

    if (endTimestamp !== null) {
        paramIndex++;
        dateConditions += ` AND ets <= $${paramIndex}`;
        queryParams.push(endTimestamp);
    }

    paramIndex++;
    dateConditions += ` AND ets <= $${paramIndex}`;
    queryParams.push(Date.now());

    let query = `
        WITH combined_sessions AS (
            SELECT sid, fingerprint_id as uid, questiontext, ets
            FROM questions
            WHERE sid IS NOT NULL AND fingerprint_id IS NOT NULL AND answertext IS NOT NULL${dateConditions}
              AND ${channelClause}
            UNION ALL
            SELECT sid, fingerprint_id as uid, NULL as questiontext, ets
            FROM feedback
            WHERE sid IS NOT NULL AND fingerprint_id IS NOT NULL ${dateConditions}
              AND ${channelClause}
            UNION ALL
            SELECT sid, fingerprint_id as uid, NULL as questiontext, ets
            FROM errordetails
            WHERE sid IS NOT NULL AND fingerprint_id IS NOT NULL${dateConditions}
              AND ${channelClause}
        )
        SELECT sid as session_id, uid as username,
               COUNT(questiontext) as question_count,
               MAX(ets) as session_time
        FROM combined_sessions
        GROUP BY sid, uid
    `;

    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` HAVING (sid ILIKE $${paramIndex} OR uid ILIKE $${paramIndex})`;
        queryParams.push(`%${search.trim()}%`);
    }

    const sortArray = ["question_count", "username", "session_id", "session_time"];
    if (sortArray.includes(sortBy)) {
        query += ` ORDER BY ${sortBy === "session_time" ? "session_time" : sortBy} ${sortOrder}`;
    } else {
        query += ` ORDER BY session_time DESC`;
    }

    if (pagination) {
        paramIndex++;
        query += ` LIMIT $${paramIndex}`;
        queryParams.push(limit);
        paramIndex++;
        query += ` OFFSET $${paramIndex}`;
        queryParams.push(offset);
    }

    const result = await pool.query(query, queryParams);
    return result.rows;
}

async function getTotalSessionsCount(search = '', startDate = null, endDate = null, telemetryState = null) {
    const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);

    // MV-first: just count rows in mv_sessions_daily that match the filter.
    if (await mvExists('mv_sessions_daily')) {
        try {
            const params = [];
            const conditions = [];
            let idx = 0;
            if (startTimestamp !== null) {
                idx++;
                conditions.push(`last_ets >= $${idx}`);
                params.push(startTimestamp);
            }
            if (endTimestamp !== null) {
                idx++;
                conditions.push(`last_ets <= $${idx}`);
                params.push(endTimestamp);
            }
            if (search && search.trim() !== '') {
                idx++;
                conditions.push(`(sid ILIKE $${idx} OR uid ILIKE $${idx})`);
                params.push(`%${search.trim()}%`);
            }
            const {
                clause: mvChannelClause,
                paramIndex: mvChannelParamIndex,
            } = buildChannelFilterClause('channel', telemetryState, params, idx);
            idx = mvChannelParamIndex;
            conditions.push(mvChannelClause);
            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
            const result = await pool.query(
                `SELECT COUNT(*)::bigint AS total FROM mv_sessions_daily ${where}`,
                params
            );
            return parseInt(result.rows[0].total, 10) || 0;
        } catch (mvErr) {
            console.warn('[Sessions] MV count query failed, falling back:', mvErr.message);
        }
    }

    // Fallback: legacy 3-table UNION.
    let dateConditions = '';
    const queryParams = [];
    let paramIndex = 0;
    const {
        clause: channelClause,
        paramIndex: channelParamIndex,
    } = buildChannelFilterClause("channel", telemetryState, queryParams, paramIndex);
    paramIndex = channelParamIndex;
    if (startTimestamp !== null) {
        paramIndex++;
        dateConditions += ` AND ets >= $${paramIndex}`;
        queryParams.push(startTimestamp);
    }
    if (endTimestamp !== null) {
        paramIndex++;
        dateConditions += ` AND ets <= $${paramIndex}`;
        queryParams.push(endTimestamp);
    }
    paramIndex++;
    dateConditions += ` AND ets <= $${paramIndex}`;
    queryParams.push(Date.now());

    let query = `
        WITH combined_sessions AS (
            SELECT sid, fingerprint_id as uid, questiontext, ets FROM questions
            WHERE sid IS NOT NULL AND fingerprint_id IS NOT NULL AND answertext IS NOT NULL${dateConditions}
              AND ${channelClause}
            UNION ALL
            SELECT sid, fingerprint_id as uid, NULL as questiontext, ets FROM feedback
            WHERE sid IS NOT NULL AND fingerprint_id IS NOT NULL ${dateConditions}
              AND ${channelClause}
            UNION ALL
            SELECT sid, fingerprint_id as uid, NULL as questiontext, ets FROM errordetails
            WHERE sid IS NOT NULL AND fingerprint_id IS NOT NULL${dateConditions}
              AND ${channelClause}
        ),
        session_groups AS (
            SELECT sid, uid, COUNT(questiontext) as question_count, MAX(ets) as session_time
            FROM combined_sessions GROUP BY sid, uid
        )
        SELECT COUNT(*) as total FROM session_groups
    `;

    if (search && search.trim() !== '') {
        paramIndex++;
        query += ` WHERE (sid ILIKE $${paramIndex} OR uid ILIKE $${paramIndex})`;
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
                // Convert to IST timezone
                sessionTime = formatDateToIST(timestamp);
            } else {
                // If not a timestamp, try parsing as a date string
                const parsedDate = new Date(row.session_time);
                sessionTime = formatDateToIST(parsedDate.getTime());
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
        sessionTime,
        timestamp: row.session_time
    };
}

const getSessions = async (req, res) => {
    try {
        const telemetryState = req.telemetryState;
        // Extract and sanitize pagination parameters from query string
        const pagination = req.query.pagination !== 'false';
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const search = req.query.search ? String(req.query.search).trim() : '';
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        const sortBy = req.query.sortBy;
        const sortOrder = req.query.sortOrder === "asc" ? "ASC" : "DESC";

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

        // Fetch paginated sessions data and total count
        const [sessionsData, totalCount] = await Promise.all([
            fetchSessionsFromDB(page, limit, search, startDate, endDate, sortBy, sortOrder, pagination, telemetryState),
            getTotalSessionsCount(search, startDate, endDate, telemetryState)
        ]);

        const formattedData = sessionsData.map(formatSessionData);

        // Calculate pagination metadata
        let responsePagination;
        if (pagination) {
            const totalPages = Math.ceil(totalCount / limit);
            const hasNextPage = page < totalPages;
            const hasPreviousPage = page > 1;
            responsePagination = {
                currentPage: page,
                totalPages: totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: hasNextPage,
                hasPreviousPage: hasPreviousPage,
                nextPage: hasNextPage ? page + 1 : null,
                previousPage: hasPreviousPage ? page - 1 : null
            };
        } else {
            responsePagination = {
                currentPage: 1,
                totalPages: 1,
                totalItems: totalCount,
                itemsPerPage: totalCount,
                hasNextPage: false,
                hasPreviousPage: false,
                nextPage: null,
                previousPage: null
            };
        }

        // Return paginated response
        res.status(200).json({
            success: true,
            data: formattedData,
            pagination: responsePagination,
            filters: {
                search: search,
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

// Get single session details by session ID with date filtering
const getSessionById = async (req, res) => {
    try {
        const telemetryState = req.telemetryState;
        const { sessionId } = req.params;
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

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

        // Build date filtering conditions
        let dateConditions = '';
        const queryParams = [sessionId.trim()];
        let paramIndex = 1;

        if (startTimestamp !== null) {
            paramIndex++;
            dateConditions += ` AND ets >= $${paramIndex}`;
            queryParams.push(startTimestamp);
        }

        if (endTimestamp !== null) {
            paramIndex++;
            dateConditions += ` AND ets <= $${paramIndex}`;
            queryParams.push(endTimestamp);
        }

        const {
            clause: channelClause,
            paramIndex: channelParamIndex,
        } = buildChannelFilterClause('channel', telemetryState, queryParams, paramIndex);
        paramIndex = channelParamIndex;

        // Get session details with all related data and date filtering
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
                    WHERE sid = $1 AND answertext IS NOT NULL${dateConditions}
                      AND ${channelClause}
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
                    WHERE sid = $1 AND answertext IS NOT NULL${dateConditions}
                      AND ${channelClause}
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
                    WHERE sid = $1${dateConditions}
                      AND ${channelClause}
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
            values: queryParams,
        };

        const result = await pool.query(query);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: "No session found for the given ID and date range"
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
            data: sessionData,
            filters: {
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching session by ID:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching session data"
        });
    }
};

// Get sessions by user ID with date filtering
const getSessionsByUserId = async (req, res) => {
    try {
        const telemetryState = req.telemetryState;
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

        // Build date filtering conditions
        let dateConditions = '';
        const queryParams = [userId.trim()];
        const countParams = [userId.trim()];
        let queryParamIndex = 1;
        let countParamIndex = 1;

        if (startTimestamp !== null) {
            queryParamIndex++;
            countParamIndex++;
            dateConditions += ` AND ets >= $${queryParamIndex}`;
            queryParams.push(startTimestamp);
            countParams.push(startTimestamp);
        }

        if (endTimestamp !== null) {
            queryParamIndex++;
            countParamIndex++;
            dateConditions += ` AND ets <= $${queryParamIndex}`;
            queryParams.push(endTimestamp);
            countParams.push(endTimestamp);
        }

        const {
            clause: queryChannelClause,
            paramIndex: queryChannelParamIndex,
        } = buildChannelFilterClause('channel', telemetryState, queryParams, queryParamIndex);
        queryParamIndex = queryChannelParamIndex;

        const {
            clause: countChannelClause,
        } = buildChannelFilterClause('channel', telemetryState, countParams, countParamIndex);

        // Add pagination params
        queryParams.push(limit, offset);

        // Get sessions by user ID with pagination and date filtering
        const sessionsQuery = {
            text: `
                WITH combined_sessions AS (
                    SELECT 
                        sid,
                        uid,
                        questiontext,
                        ets
                    FROM questions
                    WHERE sid IS NOT NULL AND uid = $1 AND answertext IS NOT NULL${dateConditions}
                      AND ${queryChannelClause}
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM feedback
                    WHERE sid IS NOT NULL AND uid = $1${dateConditions}
                      AND ${queryChannelClause}
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM errordetails
                    WHERE sid IS NOT NULL AND uid = $1${dateConditions}
                      AND ${queryChannelClause}
                )
                SELECT 
                    sid as session_id,
                    uid as username,
                    COUNT(questiontext) as question_count,
                    MAX(ets) as session_time
                FROM combined_sessions
                GROUP BY sid, uid
                ORDER BY session_time DESC
                LIMIT $${queryParamIndex + 1} OFFSET $${queryParamIndex + 2}
            `,
            values: queryParams,
        };

        // Get total count for user with date filtering
        const countQuery = {
            text: `
                WITH combined_sessions AS (
                    SELECT 
                        sid,
                        uid,
                        questiontext,
                        ets
                    FROM questions
                    WHERE sid IS NOT NULL AND uid = $1 AND answertext IS NOT NULL${dateConditions}
                      AND ${countChannelClause}
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM feedback
                    WHERE sid IS NOT NULL AND uid = $1${dateConditions}
                      AND ${countChannelClause}
                    UNION ALL
                    SELECT 
                        sid,
                        uid,
                        NULL as questiontext,
                        ets
                    FROM errordetails
                    WHERE sid IS NOT NULL AND uid = $1${dateConditions}
                      AND ${countChannelClause}
                )
                SELECT COUNT(DISTINCT sid) as total
                FROM combined_sessions
            `,
            values: countParams,
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
            filters: {
                userId: userId.trim(),
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching sessions by user ID:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching user sessions"
        });
    }
};

// Get comprehensive session statistics with date filtering
const getSessionStats = async (req, res) => {
    try {
        const telemetryState = req.telemetryState;
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

        // Validate date range
        const { startTimestamp, endTimestamp } = parseDateRange(startDate, endDate);
        if ((startDate && startTimestamp === null) || (endDate && endTimestamp === null)) {
            return res.status(400).json({
                success: false,
                error: "Invalid date format. Use ISO date string (YYYY-MM-DD) or unix timestamp"
            });
        }

        // Build date filtering
        let dateFilter = '';
        const queryParams = [];
        let paramIndex = 0;

        if (startTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets >= $${paramIndex}`;
            queryParams.push(startTimestamp);
        }

        if (endTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets <= $${paramIndex}`;
            queryParams.push(endTimestamp);
        }

        // MV-first: count rows in mv_sessions_daily.
        let total = null;
        let source = 'base';
        if (await mvExists('mv_sessions_daily')) {
            try {
                const params = [];
                const conds = [];
                let idx = 0;
                if (startTimestamp !== null) {
                    idx++;
                    conds.push(`last_ets >= $${idx}`);
                    params.push(startTimestamp);
                }
                if (endTimestamp !== null) {
                    idx++;
                    conds.push(`last_ets <= $${idx}`);
                    params.push(endTimestamp);
                }
                const { clause: mvChannelClause } = buildChannelFilterClause(
                    'channel',
                    telemetryState,
                    params,
                    idx,
                );
                conds.push(mvChannelClause);
                const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
                const mvRes = await pool.query(
                    `SELECT COUNT(*)::bigint AS total_sessions FROM mv_sessions_daily ${where}`,
                    params
                );
                total = parseInt(mvRes.rows[0].total_sessions, 10) || 0;
                source = 'mv';
            } catch (mvErr) {
                console.warn('[SessionStats] MV query failed, falling back:', mvErr.message);
            }
        }

        const {
            clause: channelClause,
            paramIndex: channelParamIndex,
        } = buildChannelFilterClause('channel', telemetryState, queryParams, paramIndex);
        paramIndex = channelParamIndex;
        dateFilter += ` AND ${channelClause}`;

        if (total == null) {
            const query = {
                text: `
                    SELECT COUNT(DISTINCT session_user_pair) as total_sessions
                    FROM (
                        SELECT CONCAT(sid, '_', uid) as session_user_pair FROM questions
                        WHERE sid IS NOT NULL AND answertext IS NOT NULL ${dateFilter}
                        UNION
                        SELECT CONCAT(sid, '_', uid) as session_user_pair FROM feedback
                        WHERE sid IS NOT NULL ${dateFilter}
                        UNION
                        SELECT CONCAT(sid, '_', uid) as session_user_pair FROM errordetails
                        WHERE sid IS NOT NULL ${dateFilter}
                    ) combined_sessions
                `,
                values: queryParams,
            };
            const result = await pool.query(query);
            total = parseInt(result.rows[0].total_sessions, 10) || 0;
        }

        res.status(200).json({
            success: true,
            data: { totalSessions: total },
            meta: { source },
            filters: {
                startDate: startDate,
                endDate: endDate,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error("Error fetching session stats:", error);
        res.status(500).json({
            success: false,
            error: "Error fetching session statistics"
        });
    }
};

// Get sessions graph data for time-series visualization
const getSessionsGraph = async (req, res) => {
    try {
        const telemetryState = req.telemetryState;
        const startDate = req.query.startDate ? String(req.query.startDate).trim() : null;
        const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;
        const granularity = req.query.granularity ? String(req.query.granularity).trim() : 'daily';
        const search = req.query.search ? String(req.query.search).trim() : '';

        // Validate granularity parameter
        if (!['daily', 'hourly', 'weekly', 'monthly'].includes(granularity)) {
            return res.status(400).json({
                success: false,
                error: "Invalid granularity. Must be 'daily', 'hourly', 'weekly', or 'monthly'"
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

        // Build date filtering
        let dateFilter = '';
        const queryParams = [];
        let paramIndex = 0;

        if (startTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets >= $${paramIndex}`;
            queryParams.push(startTimestamp);
        }

        if (endTimestamp !== null) {
            paramIndex++;
            dateFilter += ` AND ets <= $${paramIndex}`;
            queryParams.push(endTimestamp);
        }


        // Add search filter if provided
        if (search && search.trim() !== '') {
            paramIndex++;
            dateFilter += ` AND (
                sid ILIKE $${paramIndex} OR 
                uid ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${search.trim()}%`);
        }

        const {
            clause: channelClause,
            paramIndex: channelParamIndex,
        } = buildChannelFilterClause('channel', telemetryState, queryParams, paramIndex);
        paramIndex = channelParamIndex;

        // Exclude future sessions (ets > now)
        let futureFilter = '';
        paramIndex++;
        futureFilter = ` AND ets <= $${paramIndex}`;
        queryParams.push(Date.now());

        // Define the date truncation and formatting based on granularity
        let dateGrouping;
        let dateFormat;
        let orderBy;

        switch (granularity) {
            case 'hourly':
                dateGrouping = epochMsDateTruncIst('hour', 'ets');
                dateFormat = `TO_CHAR(${dateGrouping}, 'YYYY-MM-DD HH24:00')`;
                orderBy = "hour_bucket";
                break;
            case 'weekly':
                dateGrouping = epochMsDateTruncIst('week', 'ets');
                dateFormat = `TO_CHAR(${dateGrouping}, 'YYYY-MM-DD')`;
                orderBy = "week_bucket";
                break;
            case 'monthly':
                dateGrouping = epochMsDateTruncIst('month', 'ets');
                dateFormat = `TO_CHAR(${dateGrouping}, 'YYYY-MM')`;
                orderBy = "month_bucket";
                break;
            case 'daily':
            default:
                dateGrouping = epochMsDateTruncIst('day', 'ets');
                dateFormat = `TO_CHAR(${dateGrouping}, 'YYYY-MM-DD')`;
                orderBy = "day_bucket";
                break;
        }

        // MV fast-path: daily granularity without search uses mv_sessions_daily.
        let result = null;
        let source = 'base';
        if (granularity === 'daily' && !search && await mvExists('mv_sessions_daily')) {
            try {
                const mvParams = [];
                const conds = [];
                if (startTimestamp !== null) {
                    mvParams.push(startTimestamp);
                    conds.push(`last_ets >= $${mvParams.length}`);
                }
                if (endTimestamp !== null) {
                    mvParams.push(endTimestamp);
                    conds.push(`last_ets <= $${mvParams.length}`);
                }
                const { clause: mvChannelClause } = buildChannelFilterClause(
                    'channel',
                    telemetryState,
                    mvParams,
                    mvParams.length,
                );
                conds.push(mvChannelClause);
                const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
                const mvSql = `
                    SELECT
                        TO_CHAR(session_date_ist, 'YYYY-MM-DD') AS date,
                        session_date_ist AS time_bucket,
                        COUNT(*) AS sessionscount,
                        COUNT(DISTINCT sid) AS uniquesessionidscount,
                        EXTRACT(EPOCH FROM session_date_ist::timestamp) * 1000 AS timestamp,
                        NULL AS hour_of_day
                    FROM mv_sessions_daily
                    ${where}
                    GROUP BY session_date_ist
                    ORDER BY session_date_ist ASC
                `;
                result = await pool.query(mvSql, mvParams);
                source = 'mv';
            } catch (mvErr) {
                console.warn('[SessionsGraph] MV query failed, falling back:', mvErr.message);
                result = null;
            }
        }

        if (!result) {
            const query = {
                text: `
                    WITH combined_sessions AS (
                        SELECT sid, fingerprint_id as uid, ets,
                            ${dateGrouping} as time_bucket,
                            ${dateFormat} as date, 'question' as activity_type
                        FROM questions
                        WHERE sid IS NOT NULL AND fingerprint_id IS NOT NULL AND answertext IS NOT NULL AND ets IS NOT NULL${dateFilter}${futureFilter}
                          AND ${channelClause}
                        UNION ALL
                        SELECT sid, fingerprint_id as uid, ets,
                            ${dateGrouping} as time_bucket,
                            ${dateFormat} as date, 'feedback' as activity_type
                        FROM feedback
                        WHERE sid IS NOT NULL AND fingerprint_id IS NOT NULL AND ets IS NOT NULL${dateFilter}${futureFilter}
                          AND ${channelClause}
                        UNION ALL
                        SELECT sid, fingerprint_id as uid, ets,
                            ${dateGrouping} as time_bucket,
                            ${dateFormat} as date, 'error' as activity_type
                        FROM errordetails
                        WHERE sid IS NOT NULL AND fingerprint_id IS NOT NULL AND ets IS NOT NULL${dateFilter}${futureFilter}
                          AND ${channelClause}
                    ),
                    session_aggregates AS (
                        SELECT
                            date, time_bucket,
                            COUNT(DISTINCT CONCAT(sid, '_', uid)) as sessionsCount,
                            COUNT(DISTINCT sid) as uniqueSessionIdsCount,
                            EXTRACT(EPOCH FROM time_bucket) * 1000 as timestamp,
                            ${granularity === 'hourly' ? `EXTRACT(HOUR FROM time_bucket) as hour_of_day` : 'NULL as hour_of_day'}
                        FROM combined_sessions
                        GROUP BY time_bucket, date
                    )
                    SELECT date, timestamp, hour_of_day, sessionsCount, uniqueSessionIdsCount
                    FROM session_aggregates
                    ORDER BY time_bucket ASC
                `,
                values: queryParams,
            };
            result = await pool.query(query);
        }

        // Format the data for frontend consumption
        const graphData = result.rows.map(row => ({
            date: row.date,
            timestamp: parseInt(row.timestamp),
            sessionsCount: parseInt(row.sessionscount) || 0,
            uniqueSessionIdsCount: parseInt(row.uniquesessionidscount) || 0,
            // Add formatted values for different time periods
            ...(granularity === 'hourly' && {
                hour: parseInt(row.hour_of_day) || parseInt(row.date?.split(' ')[1]?.split(':')[0] || '0')
            }),
            ...(granularity === 'weekly' && { week: row.date }),
            ...(granularity === 'monthly' && { month: row.date })
        }));

        // Calculate summary statistics
        const totalSessions = graphData.reduce((sum, item) => sum + item.sessionsCount, 0);

        // Find peak activity period
        const peakPeriod = graphData.reduce((max, item) =>
            item.sessionsCount > max.sessionsCount ? item : max,
            { sessionsCount: 0, date: null }
        );

        res.status(200).json({
            success: true,
            data: graphData,
            metadata: {
                granularity: granularity,
                totalDataPoints: graphData.length,
                dateRange: {
                    start: graphData.length > 0 ? graphData[0].date : null,
                    end: graphData.length > 0 ? graphData[graphData.length - 1].date : null
                },
                summary: {
                    totalSessions: totalSessions,
                    peakActivity: {
                        date: peakPeriod.date,
                        sessionsCount: peakPeriod.sessionsCount
                    }
                }
            },
            meta: { source },
            filters: {
                search: search,
                startDate: startDate,
                endDate: endDate,
                granularity: granularity,
                appliedStartTimestamp: startTimestamp,
                appliedEndTimestamp: endTimestamp
            }
        });
    } catch (error) {
        console.error('Error fetching sessions graph data:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
};

module.exports = {
    getSessions,
    getSessionById,
    getSessionsByUserId,
    getSessionStats,
    getSessionsGraph,
    getTotalSessionsCount,
    fetchSessionsFromDB,
    formatSessionData
};
