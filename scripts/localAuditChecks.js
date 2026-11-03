const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const config = { ...require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env'))), ...process.env };
if (!['localhost', '127.0.0.1', '::1'].includes(config.DB_HOST)) throw new Error('A local database host is required');
const local = new Pool({ host: config.DB_HOST, port: Number(config.DB_PORT || 5432), database: 'mh-17-10',
  user: config.DB_USER, password: config.DB_PASSWORD, ssl: false, max: 1, connectionTimeoutMillis: 5000,
  application_name: 'mh-service-audit-local-only', options: '-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=2000' });
const reportingPool = require('../services/db');
const errors = require('../controllers/error.controller');
const feedback = require('../controllers/feedback.controller');
const dashboard = require('../controllers/dashboard.controller');
const sessions = require('../controllers/sessions.controller');
const users = require('../controllers/user.controller');
const { getServiceSnapshot } = require('../controllers/serviceSnapshot.controller');
const { getServiceApiCalls } = require('../controllers/serviceApiCalls.controller');
const { getIndividualApiCalls, getIndividualApiCall } = require('../controllers/individualApiCalls.controller');
const { parseDateRange } = require('../utils/dateUtils');
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value;return this; }, json(body) { this.body = body;return this; } });
const report = { database: 'mh-17-10', publicBusinessWrites: 0, checks: {} };

async function verifyServiceReports(connection, query, occurrence) {
  const endpoint = '/webservices/fetch_nearest_five_common_data_by_location_and_category';
  for (let i = 0; i < 15; i++) {
    const category = i < 10 ? 'chc' : 'rent';
    const success = i < 9 || i === 10;
    await connection.query(`INSERT INTO pg_temp.external_api_events(event_mid,event_name,trace_scope,service,endpoint,method,outcome,duration_ms,event_time,request_payload)
      VALUES($1,'provider_request','beckn_external_api','mh-provider-backend','/provider','POST',$2,$3,$4,$5)`,
      [`synthetic-provider-${i}`, success ? 'success' : 'failure', i < 10 ? 100 : 900, new Date(occurrence),
        { message: { intent: { category: { descriptor: { code: category } } } } }]);
  }
  const directIds = [];
  for (const category of ['chc', 'rent']) {
    const inserted = await connection.query(`INSERT INTO pg_temp.external_api_events(event_mid,event_name,trace_scope,service,endpoint,method,outcome,event_time,request_payload,response_payload)
      VALUES($1,'provider_webservice_call','beckn_external_api','mh-provider-backend',$2,'POST','success',$3,$4,'null'::jsonb) RETURNING id`,
      [`synthetic-api-${category}`, `https://test-user:test-password@example.invalid${endpoint}?api_key=SYNTHETIC_SECRET`, new Date(occurrence), { category }]);
    directIds.push(inserted.rows[0].id);
  }
  await connection.query(`INSERT INTO pg_temp.external_api_events(event_mid,event_name,trace_scope,service,endpoint,method,outcome,event_time)
    VALUES('synthetic-standalone','provider_webservice_call','beckn_external_api','mh-provider-backend','/webservices/warehouse_center_info','POST','success',$1)`, [new Date(occurrence)]);
  const snapshot = response();await getServiceSnapshot({ query }, snapshot);
  assert.equal(snapshot.statusCode, 200);
  const service = snapshot.body.data.providers[0].services.find(row => row.key === 'chc');
  assert.equal(service.metrics.requests, 15);assert.equal(service.metrics.successfulRequests, 10);
  assert.equal(service.metrics.failedRequests, 5);assert.equal(service.metrics.p90LatencyMs, 900);assert.equal(service.metrics.maxLatencyMs, 900);
  assert.equal(service.apis.length, 2);assert.notEqual(service.apis[0].key, service.apis[1].key);
  for (const api of service.apis) {
    const calls = response();await getServiceApiCalls({ query: { ...query, sourceService: api.sourceService, endpoint: api.endpoint,
      method: api.method, kind: api.kind, categories: JSON.stringify(api.scopeCategories) } }, calls);
    assert.equal(calls.statusCode, 200);assert.equal(calls.body.pagination.total, 1);
    assert.equal(calls.body.data.calls[0].has_response_payload, false);
    assert.ok(!JSON.stringify(calls.body).includes('SYNTHETIC_SECRET'));
  }
  const detail = response();await getIndividualApiCall({ params: { id: String(directIds[0]) } }, detail);
  assert.equal(detail.statusCode, 200);assert.ok(!detail.body.data.endpoint.includes('test-password'));
  assert.ok(!detail.body.data.endpoint.includes('SYNTHETIC_SECRET'));
  const individual = response();await getIndividualApiCalls({ query }, individual);
  assert.equal(individual.statusCode, 200);assert.equal(individual.body.pagination.total, 18);
  assert.ok(individual.body.data.calls.some(call => call.endpoint === '/webservices/warehouse_center_info'));
  assert.equal(snapshot.body.data.summary.apiRequests, 2);
  report.checks.combined_totals_and_true_percentile = { requests: 15, p90: 900, max: 900 };
  report.checks.separate_api_group_drilldowns = true;
  report.checks.older_url_credentials_hidden = true;
  report.checks.older_json_null_flags = true;
  report.checks.standalone_visibility_policy_unchanged = true;
}

async function main() {
  let connection;
  try {
    connection = await local.connect();
    const identity = (await connection.query('SELECT current_database() AS db, inet_server_addr()::text AS address')).rows[0];
    assert.equal(identity.db, 'mh-17-10');assert.ok(['127.0.0.1/32', '::1/128'].includes(identity.address));
    let queued = Promise.resolve();
    reportingPool.query = (query, values) => {
      const sql = typeof query === 'string' ? query : query.text;
      assert.match(sql.trim(), /^(SELECT|WITH)\b/i, 'Controller verification must remain read-only');
      const result = queued.then(() => connection.query(query, values));
      queued = result.catch(() => {});
      return result;
    };
    const query = { startDate: '2026-10-14T00:00:00.000', endDate: '2026-10-14T23:59:59.999' };
    const directRange = parseDateRange(query.startDate, query.endDate);
    const expected = Number((await connection.query('SELECT count(*) FROM public.errordetails WHERE ets >= $1 AND ets <= $2 AND errortext IS NOT NULL',
      [directRange.startTimestamp, directRange.endTimestamp])).rows[0].count);
    const restored = response();await errors.getAllErrors({ query }, restored);
    assert.equal(restored.statusCode, 200);assert.equal(restored.body.total, expected);assert.equal(expected, 81);
    const graph = response();await errors.getErrorGraph({ query: { ...query, granularity: 'daily' } }, graph);
    assert.equal(graph.statusCode, 200);assert.equal(graph.body.data.reduce((sum, row) => sum + row.errorCount, 0), expected);
    const alias = response();await errors.getErrorGraph({ query: { ...query, granularity: 'day' } }, alias);
    assert.deepEqual(alias.body, graph.body);
    report.checks.restored_error_date = { expected, actual: restored.body.total, graphTotal: expected };

    await connection.query('BEGIN');
    for (const table of ['questions', 'feedback', 'errordetails', 'external_api_events']) {
      await connection.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await connection.query('CREATE TEMP SEQUENCE audit_service_event_ids');
    await connection.query("ALTER TABLE pg_temp.external_api_events ALTER COLUMN id SET DEFAULT nextval('pg_temp.audit_service_event_ids')");
    await connection.query('CREATE TEMP TABLE mv_user_first_activity(uid text,first_date date)');
    await connection.query("INSERT INTO pg_temp.mv_user_first_activity VALUES('guest','2026-10-14')");
    const occurrence = Date.UTC(2026, 9, 13, 19); // 00:30 IST on October 14.
    for (const answer of [null, '', 'Synthetic completed answer']) {
      await connection.query('INSERT INTO pg_temp.questions(uid,sid,ets,questiontext,answertext) VALUES($1,$2,$3,$4,$5)',
        ['guest', 'synthetic-session', occurrence, 'Synthetic question', answer]);
    }
    const feedbackCases = [
      ['like', null], ['like', ''], ['like', ' \t\n'], ['like', 'Helpful'],
      ['dislike', 'Synthetic comment'], ['dislike', null], ['dislike', ''],
      ['dislike', ' \t\r\n'], ['dislike', '\u00a0'], ['dislike', '\ufeff'],
    ];
    let invalidFeedbackId;
    for (const [rating, comment] of feedbackCases) {
      const standaloneInvalid = comment === '\ufeff';
      const inserted = await connection.query(`INSERT INTO pg_temp.feedback(uid,sid,ets,feedbacktype,feedbacktext,answertext,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [standaloneInvalid ? 'invalid-feedback-user' : 'guest', standaloneInvalid ? 'invalid-feedback-only' : 'synthetic-session',
          occurrence, rating, comment, 'Synthetic answer', new Date(Date.UTC(2026, 9, 18))]);
      if (rating === 'dislike' && comment === null) invalidFeedbackId = inserted.rows[0].id;
    }
    for (const ets of [occurrence, Date.UTC(2026, 9, 14, 19)]) {
      await connection.query('INSERT INTO pg_temp.errordetails(uid,sid,ets,errortext,created_at) VALUES($1,$2,$3,$4,$5)',
        ['guest', 'synthetic-session', ets, 'Synthetic late error', new Date(Date.UTC(2026, 9, 18))]);
    }
    const stats = response();await dashboard.getDashboardStats({ query }, stats);
    assert.equal(stats.statusCode, 200);
    assert.equal(stats.body.totalQuestions ?? stats.body.data?.totalQuestions, 1);
    assert.equal(stats.body.totalFeedback ?? stats.body.data?.totalFeedback, 5);
    assert.equal(stats.body.totalUsers ?? stats.body.data?.totalUsers, 1);
    assert.equal(stats.body.totalSessions ?? stats.body.data?.totalSessions, 1);
    const feedbackRows = await feedback.fetchAllFeedbackFromDB(1, 10, '', query.startDate, query.endDate);
    assert.equal(feedbackRows.length, 5);assert.equal(await feedback.getTotalFeedbackCount('', query.startDate, query.endDate), 5);
    assert.deepEqual(await feedback.getTotalLikesDislikesCount('', query.startDate, query.endDate), { totalLikes: 4, totalDislikes: 1 });
    const ratings = response();await feedback.getFeedbackGraph({ query: { ...query, granularity: 'daily' } }, ratings);
    assert.equal(ratings.statusCode, 200);assert.equal(ratings.body.metadata.summary.totalFeedback, 5);
    assert.ok(ratings.body.data.every(row => row.date === '2026-10-14'));
    const lateErrors = response();await errors.getAllErrors({ query }, lateErrors);
    assert.equal(lateErrors.statusCode, 200);assert.equal(lateErrors.body.total, 1);
    assert.equal(lateErrors.body.data[0].fullDate, new Date(occurrence).toISOString());
    report.checks.empty_answer_counts_and_shared_guest = true;
    report.checks.rating_only_feedback_in_ist = true;
    const feedbackStats = response();await feedback.getFeedbackStats({ query }, feedbackStats);
    assert.equal(feedbackStats.statusCode, 200);assert.equal(feedbackStats.body.data.totalFeedback, 5);
    const feedbackBySession = response();await feedback.getFeedbackBySessionId({ query, params: { sessionId: 'synthetic-session' } }, feedbackBySession);
    assert.equal(feedbackBySession.statusCode, 200);assert.equal(feedbackBySession.body.pagination.totalItems, 5);
    const timeline = response();await sessions.getSessionById({ query, params: { sessionId: 'synthetic-session' } }, timeline);
    assert.equal(timeline.statusCode, 200);assert.equal(timeline.body.data.feedback.length, 5);
    const userFeedback = response();await users.getFeedbackStats({ query }, userFeedback);
    assert.equal(userFeedback.statusCode, 200);assert.equal(userFeedback.body.data.totalFeedback, 5);
    const hiddenDetail = response();await feedback.getFeedbackByid({ params: { id: invalidFeedbackId } }, hiddenDetail);
    assert.equal(hiddenDetail.statusCode, 404);
    assert.equal(Number((await connection.query('SELECT count(*) FROM pg_temp.feedback')).rows[0].count), feedbackCases.length,
      'historical invalid rows remain stored');
    report.checks.feedback_comment_policy = { stored: feedbackCases.length, reported: 5, likes: 4, dislikes: 1, invalidRowsRetained: true };
    report.checks.late_error_and_ist_boundary = true;

    await verifyServiceReports(connection, query, occurrence);
    report.success = true;
  } catch (error) {
    report.success = false;report.error = { code: error.code || error.name, message: error.message };process.exitCode = 1;
  } finally {
    if (connection) { await connection.query('ROLLBACK').catch(() => {});connection.release(); }
    await local.end();await reportingPool.end();
    if (process.env.LOCAL_TEST_REPORT) fs.writeFileSync(process.env.LOCAL_TEST_REPORT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}

main().catch(error => {
  console.error('Local database audit cleanup failed:', error.code || error.name);
  process.exitCode = 1;
});
