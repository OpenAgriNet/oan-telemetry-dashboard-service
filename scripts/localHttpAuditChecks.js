const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const config = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
if (!['localhost', '127.0.0.1', '::1'].includes(config.DB_HOST)) throw new Error('Local database configuration required');
Object.assign(process.env, { DB_HOST: config.DB_HOST, DB_PORT: config.DB_PORT || '5432', DB_NAME: 'mh-17-10',
  DB_USER: config.DB_USER, DB_PASSWORD: config.DB_PASSWORD, NODE_ENV: 'test', LOCAL_DEV_AUTH_BYPASS: 'false',
  PGOPTIONS: '-c default_transaction_read_only=on -c timezone=UTC -c statement_timeout=30000 -c application_name=mh-service-local-http-audit' });
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
let issuerServer, server, pool;
const logs = [];
const write = process.stdout.write;
const report = { database: 'mh-17-10', loopbackOnly: true, readOnly: true, checks: {} };
(async () => {
  try {
    const jose = await import('jose');
    const pair = await jose.generateKeyPair('RS256', { extractable: true });
    const jwk = await jose.exportJWK(pair.publicKey);jwk.kid = 'synthetic-local-audit';jwk.alg = 'RS256';jwk.use = 'sig';
    issuerServer = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json');res.end(JSON.stringify({ keys: [jwk] })); });
    issuerServer.listen(0, '127.0.0.1');await once(issuerServer, 'listening');
    const issuer = `http://127.0.0.1:${issuerServer.address().port}/auth/realms/local-audit`;
    process.env.KEYCLOAK_ISSUER_URL = issuer;
    const { app } = require('../index');pool = require('../services/db');
    const identity = (await pool.query("SELECT current_database() AS db, inet_server_addr()::text AS address, current_setting('transaction_read_only') AS read_only")).rows[0];
    assert.equal(identity.db, 'mh-17-10');assert.ok(['127.0.0.1/32', '::1/128'].includes(identity.address));assert.equal(identity.read_only, 'on');
    assert.equal(require('node-cron').getTasks().size, 0);
    server = app.listen(0, '127.0.0.1');await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = roles => new jose.SignJWT({ preferred_username: 'synthetic-audit-user', realm_access: { roles } })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(issuer).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const ordinary = await token([]), viewer = await token(['telemetry-detail-viewer']);
    const headers = { Authorization: `Bearer ${ordinary}` };
    process.stdout.write = function(chunk, encoding, callback) {
      logs.push(String(chunk));if (typeof encoding === 'function') encoding();else if (typeof callback === 'function') callback();return true;
    };
    const dates = 'startDate=2026-10-14T00%3A00%3A00.000&endDate=2026-10-14T23%3A59%3A59.999';
    assert.equal((await fetch(`${base}/v1/errors?token=${ordinary}`)).status, 401);
    const list = await fetch(`${base}/v1/errors?${dates}`, { headers });assert.equal(list.status, 200);
    const body = await list.json();assert.equal(body.total, 81);
    const id = body.data[0].id;
    assert.equal((await fetch(`${base}/v1/errors/id/${id}`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/v1/errors/id/${id}`, { headers: { Authorization: `Bearer ${viewer}` } })).status, 200);
    const alias = await fetch(`${base}/v1/errors/graph?${dates}&granularity=daily`, { headers });assert.equal(alias.status, 200);
    assert.equal((await alias.json()).data.reduce((sum, row) => sum + row.errorCount, 0), 81);
    assert.equal((await fetch(`${base}/v1/errors/graph?${dates}&granularity=unsupported`, { headers })).status, 400);
    await new Promise(resolve => setImmediate(resolve));
    const output = logs.join('');assert.ok(output.includes('GET'));assert.ok(output.includes('200'));assert.ok(output.includes('401'));
    assert.ok(!output.includes(ordinary));assert.ok(!output.includes(viewer));assert.ok(!output.includes('?token='));
    report.checks = { signed_header_authentication: true, url_token_rejected: true, detail_role_preserved: true,
      restored_error_count: 81, graph_alias_and_validation: true, sanitized_request_logs: true, no_started_jobs: true };
    report.success = true;
  } catch (error) {
    report.success = false;report.error = { code: error.code || error.name, message: error.message };process.exitCode = 1;
  } finally {
    process.stdout.write = write;
    if (server) await new Promise(resolve => server.close(resolve));
    if (issuerServer) await new Promise(resolve => issuerServer.close(resolve));
    if (pool) await pool.end();
    if (process.env.LOCAL_TEST_REPORT) fs.writeFileSync(process.env.LOCAL_TEST_REPORT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
})();
