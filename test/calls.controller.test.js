const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../services/db');
const originalQuery = pool.query;
const { getCallsStats } = require('../controllers/calls.controller');

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

beforeEach(() => {
    pool.query = originalQuery;
});

after(async () => {
    pool.query = originalQuery;
    await pool.end();
});

test('all-time call stats are read live from calls and messages', async () => {
    pool.query = async (sql, params) => {
        assert.match(sql, /WITH filtered_calls AS MATERIALIZED/);
        assert.match(sql, /FROM calls c/);
        assert.match(sql, /JOIN messages m ON m\.call_id = fc\.id/);
        assert.doesNotMatch(sql, /mv_call_message_counts/);
        assert.deepEqual(params, []);

        return {
            rows: [{
                total_calls: '12',
                total_users: '7',
                total_questions: '65',
                total_interactions: '131',
                avg_duration: '585.25',
            }],
        };
    };

    const res = createResponse();
    await getCallsStats({ query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, {
        totalCalls: 12,
        totalUsers: 7,
        totalQuestions: 65,
        totalInteractions: 131,
        avgDuration: 585.25,
    });
    assert.deepEqual(res.body.meta, { source: 'live' });
});

test('date-filtered stats apply the same range to the live call set', async () => {
    pool.query = async (sql, params) => {
        assert.match(sql, /c\.start_datetime >= TO_TIMESTAMP\(\$1 \/ 1000\.0\)/);
        assert.match(sql, /c\.start_datetime <= TO_TIMESTAMP\(\$2 \/ 1000\.0\)/);
        assert.equal(params.length, 2);
        assert.ok(params[0] < params[1]);

        return {
            rows: [{
                total_calls: '0',
                total_users: '0',
                total_questions: '0',
                total_interactions: '0',
                avg_duration: null,
            }],
        };
    };

    const res = createResponse();
    await getCallsStats({
        query: { startDate: '2026-07-01', endDate: '2026-07-22' },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.filters, {
        startDate: '2026-07-01',
        endDate: '2026-07-22',
    });
});

test('invalid stats dates are rejected without querying the database', async () => {
    pool.query = async () => {
        assert.fail('database should not be queried for an invalid date');
    };

    const res = createResponse();
    await getCallsStats({ query: { startDate: 'not-a-date' } }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid startDate format');
});
