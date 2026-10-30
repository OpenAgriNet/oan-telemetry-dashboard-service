const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../services/db');
const dashboard = require('../controllers/dashboard.controller');
const feedback = require('../controllers/feedback.controller');
const errors = require('../controllers/error.controller');
const individual = require('../controllers/individualApiCalls.controller');
const scoped = require('../controllers/serviceApiCalls.controller');
const { buildServiceSnapshot } = require('../services/serviceSnapshot');
const { validFeedbackSql } = require('../utils/feedbackPolicy');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const sqlText = query => typeof query === 'string' ? query : query.text;

test('headline totals exclude empty answers and require comments only for dislikes', async t => {
  let sql;
  t.mock.method(pool, 'query', async query => {
    sql = sqlText(query);
    return { rows: [{ total_users: '0', new_users: '0', total_sessions: '0', total_questions: '0', total_feedback: '0', total_likes: '0', total_dislikes: '0' }] };
  });
  const res = response();await dashboard.getDashboardStats({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(sql, /sid IS NOT NULL AND answertext IS NOT NULL AND answertext <> ''/);
  assert.match(sql, /uid IS NOT NULL AND answertext IS NOT NULL AND answertext <> ''/);
  assert.ok(sql.includes(validFeedbackSql()));
  assert.doesNotMatch(sql, /feedbacktext IS NOT NULL/);
});

test('feedback totals, lists, statistics and charts share the like/dislike comment rule', async t => {
  const seen = [];
  t.mock.method(pool, 'query', async query => {
    const sql = sqlText(query);seen.push(sql);
    return { rows: /as total_feedback|as total_likes/.test(sql) ? [{ total_feedback: '2', total_likes: '1', total_dislikes: '1' }]
      : /COUNT\(\*\) as total/.test(sql) ? [{ total: '2' }] : [] };
  });
  await feedback.fetchAllFeedbackFromDB();await feedback.getTotalFeedbackCount();
  await feedback.getTotalLikesDislikesCount();
  await feedback.getFeedbackStats({ query: {} }, response());
  await feedback.getFeedbackGraph({ query: {} }, response());
  for (const sql of seen) { assert.ok(sql.includes(validFeedbackSql()));assert.match(sql, /feedbacktype IN \('like', 'dislike'\)/); }
});

test('error list, counts, statistics and session queries use numeric event bounds', async t => {
  const start = Date.UTC(2026, 9, 14), end = Date.UTC(2026, 9, 15);
  const seen = [];
  t.mock.method(pool, 'query', async (query, values) => {
    seen.push([sqlText(query), values || query.values]);
    return { rows: /COUNT/.test(sqlText(query)) ? [{ total: '0', total_errors: '0' }] : [] };
  });
  const query = { startDate: String(start), endDate: String(end), sortBy: 'created_at', sortOrder: 'ASC; DROP TABLE test' };
  for (const [handler, params] of [[errors.getAllErrors, {}], [errors.getErrorStatistics, {}], [errors.getErrorsBySessionId, { sessionId: 'test-session' }]]) {
    const res = response();await handler({ query, params }, res);assert.equal(res.statusCode, 200);
  }
  for (const [sql, values] of seen) {
    assert.match(sql, /ets >= \$/);assert.match(sql, /ets <= \$/);
    assert.doesNotMatch(sql, /created_at [<>]=|ORDER BY created_at|DROP TABLE/);
    assert.ok(values.includes(start));assert.ok(values.includes(end));
  }
});

test('error and feedback displays use occurrence time rather than insertion time', () => {
  const ets = Date.UTC(2026, 9, 14, 10);
  const error = errors.formatErrorData({ ets, created_at: new Date(Date.UTC(2026, 9, 18)), error_message: 'test' });
  assert.equal(error.fullDate, new Date(ets).toISOString());
  assert.equal(error.processedAt.getUTCDate(), 18);
  const rating = feedback.formatFeedbackData({ ets, created_at: '2026-10-18T00:00:00Z', feedbacktype: 'like' });
  assert.equal(rating.date, require('../utils/dateUtils').formatDateToIST(ets));
  assert.equal(errors.formatErrorData({ ets: null, created_at: new Date() }).fullDate, null);
});

test('error graph accepts matching grouping aliases and rejects invalid input before SQL', async t => {
  const seen = [];
  t.mock.method(pool, 'query', async (sql, values) => { seen.push([sql, values]);return { rows: [] }; });
  const query = { startDate: '2026-10-14', endDate: '2026-10-14' };
  for (const granularity of ['day', 'daily']) {
    const res = response();await errors.getErrorGraph({ query: { ...query, granularity } }, res);assert.equal(res.statusCode, 200);
  }
  assert.deepEqual(seen[0], seen[1]);assert.match(seen[0][0], /Asia\/Kolkata/);assert.match(seen[0][0], /WHERE ets >=/);
  for (const granularity of ['year', "day'); SELECT 1;--", '__proto__']) {
    const res = response();await errors.getErrorGraph({ query: { ...query, granularity } }, res);assert.equal(res.statusCode, 400);
  }
  assert.equal(seen.length, 2);
});

test('combined service totals do not depend on row order and do not average percentiles', () => {
  const rows = [
    { source_service: 'mh-provider-backend', service_category: 'chc', service_requests: '10', successful_requests: '9', failed_requests: '1', p90_latency_ms: '100', max_latency_ms: '100' },
    { source_service: 'mh-provider-backend', service_category: 'rent', service_requests: '5', successful_requests: '1', failed_requests: '4', p90_latency_ms: '900', max_latency_ms: '900' },
  ];
  const first = buildServiceSnapshot(rows, [])[0].services[0].metrics;
  const reversed = buildServiceSnapshot([...rows].reverse(), [])[0].services[0].metrics;
  assert.deepEqual(first, reversed);assert.equal(first.requests, 15);assert.equal(first.maxLatencyMs, 900);
  assert.equal(first.successfulRequests, 10);assert.equal(first.failedRequests, 5);assert.equal(first.p90LatencyMs, null);
});

test('API rows that share an endpoint retain distinct group identities', () => {
  const service = { source_service: 'mh-provider-backend', service_category: 'chc', service_requests: '2', successful_requests: '2', failed_requests: '0', p90_latency_ms: null, max_latency_ms: null };
  const endpoint = '/webservices/fetch_nearest_five_common_data_by_location_and_category';
  const apis = ['chc', 'rent'].map(category => ({ ...service, service_categories: [category], method: 'POST', endpoint_path: endpoint, api_requests: '1' }));
  const rows = buildServiceSnapshot([service], apis)[0].services[0].apis;
  assert.notEqual(rows[0].key, rows[1].key);
  assert.deepEqual(rows.find(row => row.key === rows[1].key).scopeCategories, ['rent']);
});

test('API scope keys preserve text sorting for uppercase and accented categories', () => {
  const service = { source_service: 'mh-provider-backend', service_category: 'chc', service_requests: '1', successful_requests: '1', failed_requests: '0', p90_latency_ms: null, max_latency_ms: null };
  const endpoint = '/webservices/fetch_nearest_five_common_data_by_location_and_category';
  const api = { ...service, service_categories: ['chc', 'é', 'Z', 'a'], method: 'POST', endpoint_path: endpoint, api_requests: '1' };
  const result = buildServiceSnapshot([service], [api])[0].services[0].apis[0];
  assert.deepEqual(result.scopeCategories, ['Z', 'a', 'chc', 'é']);
  assert.equal(result.key, JSON.stringify(['POST', endpoint, ['Z', 'a', 'chc', 'é']]));
});

test('API list and detail responses hide query credentials from older captured records', async t => {
  const endpoint = 'https://test-user:test-secret@example.invalid/check?api_key=old-secret#token=old-token';
  t.mock.method(pool, 'query', async query => {
    const sql = sqlText(query);
    if (/COUNT/.test(sql)) return { rows: [{ total: 1, successful: 1, failed: 0 }] };
    if (/ARRAY_REMOVE/.test(sql)) return { rows: [{ layers: [], services: [] }] };
    return { rows: [{ id: 1, endpoint }] };
  });
  const list = response();await individual.getIndividualApiCalls({ query: {} }, list);
  const detail = response();await individual.getIndividualApiCall({ params: { id: '1' } }, detail);
  const grouped = response();await scoped.getServiceApiCalls({ query: { sourceService: 'mh-provider-backend', endpoint: '/check' } }, grouped);
  for (const res of [list, detail, grouped]) {
    assert.equal(res.statusCode, 200);
    assert.ok(!JSON.stringify(res.body).includes('secret'));assert.ok(!JSON.stringify(res.body).includes('old-token'));
  }
});

test('URL-only login tokens are rejected without contacting an identity server', async () => {
  const res = response();let allowed = false;
  await require('../controllers/auth.controller')({ headers: {}, query: { token: 'synthetic-url-token' } }, res, () => { allowed = true; });
  assert.equal(res.statusCode, 401);assert.equal(allowed, false);
});

test('importing the service starts no HTTP server, scheduled jobs or database queries', t => {
  const cron = require('node-cron');const express = require('express');
  const schedules = t.mock.method(cron, 'schedule', () => { throw new Error('Unexpected schedule'); });
  const listeners = t.mock.method(express.application, 'listen', () => { throw new Error('Unexpected listener'); });
  const queries = t.mock.method(pool, 'query', async () => { throw new Error('Unexpected database query'); });
  const service = require('../index');assert.ok(service.app);
  assert.equal(schedules.mock.callCount(), 0);assert.equal(listeners.mock.callCount(), 0);assert.equal(queries.mock.callCount(), 0);
});
