// Users, sessions and questions from the telemetry query API in amul-oan-api,
// counted over chat and voice turns. The API works in whole UTC days, both ends
// included, and needs both ends.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
// Before the first turn on record, for a dashboard range with no start date.
const ALL_TIME_FROM = "2024-01-01";
const TIMEOUT_MS = 10000;

// The IST calendar day of a UTC timestamp, as YYYY-MM-DD.
function istDay(timestamp) {
  return new Date(timestamp + IST_OFFSET_MS).toISOString().slice(0, 10);
}

async function getTelemetryTotals(startTimestamp, endTimestamp) {
  const baseUrl = (process.env.TELEMETRY_API_URL || "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.TELEMETRY_API_KEY || "").trim();
  if (!baseUrl || !apiKey) {
    throw new Error("TELEMETRY_API_URL and TELEMETRY_API_KEY must be set");
  }

  const url = new URL(`${baseUrl}/api/telemetry/stats`);
  url.searchParams.append(
    "from",
    startTimestamp === null ? ALL_TIME_FROM : istDay(startTimestamp)
  );
  url.searchParams.append(
    "to",
    istDay(endTimestamp === null ? Date.now() : endTimestamp)
  );

  const response = await fetch(url, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Telemetry API answered ${response.status}`);
  }
  const { total } = await response.json();
  return total;
}

module.exports = { getTelemetryTotals };
