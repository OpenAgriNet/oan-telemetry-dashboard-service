const { getServiceDefinition } = require('./serviceSnapshot');

// These boundaries are the last observed event and restored container start;
// they bracket the gap and are not claims about the first/last missed request.
const WINDOW_START = '2026-11-02T11:36:47.256Z';
const WINDOW_END = '2026-11-04T08:10:05.696Z';
const MH_BPP = 'prodprovidernetwork.mahapocra.gov.in';

const QUERY = `
  WITH candidates AS (
    SELECT id, outcome,
      COALESCE(NULLIF(request_payload #>> '{message,intent,category,descriptor,code}', ''),
               NULLIF(request_payload #>> '{message,intent,category,descriptor,name}', ''),
               NULLIF(request_payload #>> '{message,order,items,0,category_ids,0}', ''),
               '(unclassified)') AS category,
      NULLIF(request_payload #>> '{context,bpp_id}', '') AS target,
      (lower(trim(COALESCE(request_payload #>> '{message,intent,provider,id}', ''))) = 'smam'
       OR lower(trim(COALESCE(request_payload #>> '{message,intent,provider,descriptor,code}', ''))) = 'smam') AS excluded_provider,
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(response_payload->'responses') = 'array'
            THEN response_payload->'responses' ELSE '[]'::jsonb END
        ) r WHERE r #>> '{context,bpp_id}' = $3
      ) AS mh_response
    FROM external_api_events
    WHERE service='mahavistaar-ai-backend' AND event_name='beckn_request'
      AND event_time > $1::timestamptz AND event_time < $2::timestamptz
      AND event_time >= $4::timestamptz AND event_time <= $5::timestamptz
  )
  SELECT category, target, mh_response, excluded_provider, COUNT(*)::integer AS count
  FROM candidates GROUP BY category, target, mh_response, excluded_provider`;

async function getMhGapReconstruction(pool, range = {}) {
  const start = range.startTimestamp == null ? WINDOW_START : new Date(range.startTimestamp).toISOString();
  const end = range.endTimestamp == null ? WINDOW_END : new Date(range.endTimestamp).toISOString();
  const { rows } = await pool.query(QUERY, [WINDOW_START, WINDOW_END, MH_BPP, start, end]);
  const totals = { bapCalls: 0, explicitlyTargetedMh: 0, untargetedWithMhResponse: 0,
    untargetedWithoutMhResponse: 0, targetedOther: 0, candidateCalls: 0,
    mappedCandidateCalls: 0, unmappedCandidateCalls: 0, mhResponsesObserved: 0 };
  const services = new Map();
  for (const row of rows) {
    const n = Number(row.count);
    const isMhTarget = row.target === MH_BPP;
    const untargeted = !row.target;
    const other = !untargeted && !isMhTarget;
    totals.bapCalls += n;
    if (isMhTarget) totals.explicitlyTargetedMh += n;
    else if (untargeted && row.mh_response) totals.untargetedWithMhResponse += n;
    else if (untargeted) totals.untargetedWithoutMhResponse += n;
    else if (other) totals.targetedOther += n;
    const candidate = isMhTarget || (untargeted && row.mh_response);
    if (!candidate) continue;
    totals.candidateCalls += n;
    if (row.mh_response) totals.mhResponsesObserved += n;
    const definition = getServiceDefinition('mh-provider-backend', row.category);
    if (row.excluded_provider || definition.key.startsWith('unmapped-')) { totals.unmappedCandidateCalls += n; continue; }
    totals.mappedCandidateCalls += n;
    const entry = services.get(definition.key) || { key: definition.key, name: definition.name,
      explicitlyTargetedMh: 0, untargetedWithMhResponse: 0, mhResponsesObserved: 0, candidateCalls: 0 };
    entry.candidateCalls += n;
    if (isMhTarget) entry.explicitlyTargetedMh += n;
    else entry.untargetedWithMhResponse += n;
    if (row.mh_response) entry.mhResponsesObserved += n;
    services.set(definition.key, entry);
  }
  return { window: { startExclusive: WINDOW_START, endExclusive: WINDOW_END },
    source: 'chatbot_to_bap', reconstructed: true,
    note: 'BAP calls and observed responses are not provider-side request counts, outcomes, API calls or latency.',
    totals, services: [...services.values()].sort((a, b) => b.candidateCalls - a.candidateCalls) };
}
module.exports = { getMhGapReconstruction, QUERY, WINDOW_START, WINDOW_END, MH_BPP };
