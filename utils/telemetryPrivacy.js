// Query parameters and URL credentials are unnecessary for reporting an API's
// address. Remove them on reads as well as protecting new processor writes, so
// older captured records cannot expose a secret in their address.
function sanitizeApiCall(row) {
  if (!row || typeof row.endpoint !== 'string') return row;
  const endpoint = row.endpoint;
  try {
    const absolute = /^https?:\/\//i.test(endpoint);
    const url = new URL(endpoint, 'https://telemetry.invalid');
    return { ...row, endpoint: absolute ? `${url.origin}${url.pathname}` : url.pathname };
  } catch {
    // Older endpoint strings may not be valid URLs. Keep the fallback that
    // removes their query string and fragment when URL parsing is unavailable.
    return { ...row, endpoint: endpoint.split(/[?#]/, 1)[0] };
  }
}

module.exports = { sanitizeApiCall };
