const test = require('node:test');
const assert = require('node:assert/strict');
const { getMhGapReconstruction, MH_BPP, WINDOW_START, WINDOW_END } = require('../services/mhGapReconstruction');

test('counts only MH-targeted or untargeted calls with an MH response, never assigning other providers', async () => {
  let params;
  const pool = { query: async (_sql, values) => { params = values; return { rows: [
    { category: 'Weather-Forecast', target: MH_BPP, mh_response: false, count: 2 },
    { category: 'schemes-agri', target: null, mh_response: true, count: 3 },
    { category: 'schemes-agri', target: null, mh_response: false, count: 4 },
    { category: 'Weather-Forecast', target: 'other-provider', mh_response: true, count: 5 },
    { category: 'smam', target: MH_BPP, mh_response: true, count: 1 },
  ] }; } };
  const result = await getMhGapReconstruction(pool);
  assert.deepEqual(params, [WINDOW_START, WINDOW_END, MH_BPP, WINDOW_START, WINDOW_END]);
  assert.equal(result.totals.bapCalls, 15);
  assert.equal(result.totals.candidateCalls, 6);
  assert.equal(result.totals.mappedCandidateCalls, 5);
  assert.equal(result.totals.unmappedCandidateCalls, 1);
  assert.equal(result.totals.mhResponsesObserved, 4);
  assert.deepEqual(result.services.map(x => x.name).sort(), ['Scheme information', 'Weather – Forecast']);
  assert.equal(result.services.find(x => x.name === 'Weather – Forecast').mhResponsesObserved, 0);
});

test('treats a directly targeted MH call with an MH response as one candidate', async () => {
  const result = await getMhGapReconstruction({ query: async () => ({ rows: [
    { category: 'Weather-Forecast', target: MH_BPP, mh_response: true, count: 7 },
  ] }) });
  assert.equal(result.totals.candidateCalls, 7);
  assert.equal(result.totals.mhResponsesObserved, 7);
  assert.equal(result.services[0].explicitlyTargetedMh, 7);
});

test('keeps an explicitly excluded provider out of mapped service rows', async () => {
  const result = await getMhGapReconstruction({ query: async () => ({ rows: [
    { category: 'schemes-agri', target: MH_BPP, mh_response: true, excluded_provider: true, count: 2 },
  ] }) });
  assert.equal(result.totals.candidateCalls, 2);
  assert.equal(result.totals.mappedCandidateCalls, 0);
  assert.equal(result.totals.unmappedCandidateCalls, 2);
  assert.deepEqual(result.services, []);
});


test('passes the selected date range alongside the fixed gap bounds', async () => {
  let params;
  const pool = { query: async (_sql, values) => { params = values; return { rows: [] }; } };
  await getMhGapReconstruction(pool, { startTimestamp: Date.parse('2026-11-03T00:00:00Z'), endTimestamp: Date.parse('2026-11-03T23:59:59Z') });
  assert.deepEqual(params, [WINDOW_START, WINDOW_END, MH_BPP, '2026-11-03T00:00:00.000Z', '2026-11-03T23:59:59.000Z']);
});
