const { LangfuseConfig: config } = require("./config.js");

const authString = `${config.public_key || ""}:${config.secret_key || ""}`;
const encodedAuth = Buffer.from(authString).toString("base64");
const lfHeaders = new Headers();
lfHeaders.append("Authorization", `Basic ${encodedAuth}`);

function assertLangfuseConfig() {
  if (!config.base_url || !config.public_key || !config.secret_key) {
    throw new Error(
      "Langfuse is not configured. Set LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY"
    );
  }
}

async function fetchLangfuseJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: lfHeaders,
    redirect: "follow",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Langfuse API request failed (${response.status}): ${payload?.message || "unknown error"}`
    );
  }
  return payload;
}

function normalizeIso(dateValue) {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function sanitizeLimit(rawLimit, defaultValue = 100) {
  const parsed = parseInt(rawLimit, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(1, Math.min(1000, parsed));
}

async function getPretranslatedQueries({
  startDate = null,
  endDate = null,
  cursor = null,
  limit = 100,
}) {
  assertLangfuseConfig();
  const requestLimit = sanitizeLimit(limit, 100);
  const startIso = normalizeIso(startDate);
  const endIso = normalizeIso(endDate);

  const url = new URL(`${config.base_url.trim().replace(/\/$/, "")}/api/public/v2/observations`);
  url.searchParams.append("name", "query_pretranslation");
  url.searchParams.append("type", "GENERATION");
  url.searchParams.append("limit", String(requestLimit));
  if (cursor) url.searchParams.append("cursor", String(cursor));
  if (startIso) url.searchParams.append("fromStartTime", startIso);
  if (endIso) url.searchParams.append("toStartTime", endIso);

  const payload = await fetchLangfuseJson(url);
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  const items = rows.map((row) => {
    const input = row?.input && typeof row.input === "object" ? row.input : {};
    return {
      observationId: row?.id || null,
      traceId: row?.traceId || null,
      sessionId: row?.sessionId || null,
      userId: row?.userId || null,
      sourceLang: input?.source_lang || null,
      targetLang: input?.target_lang || null,
      originalQuery: input?.text || null,
      translatedQuery:
        typeof row?.output === "string"
          ? row.output
          : row?.output?.text || row?.output?.translated_text || null,
      startTime: row?.startTime || null,
      endTime: row?.endTime || null,
      model: row?.providedModelName || row?.model || null,
      provider: row?.metadata?.translation_provider || null,
    };
  });

  return {
    items,
    nextCursor: payload?.meta?.nextCursor || payload?.meta?.cursor || null,
  };
}

async function getEnglishQueriesFromTraces({
  startDate = null,
  endDate = null,
  page = 1,
  limit = 100,
}) {
  assertLangfuseConfig();
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const requestLimit = Math.max(1, Math.min(200, parseInt(limit, 10) || 100));
  const startIso = normalizeIso(startDate);
  const endIso = normalizeIso(endDate);
  const englishItems = [];
  let currentTracePage = safePage;
  let scannedTracePages = 0;
  let hasMorePages = true;
  let lastMeta = null;

  while (englishItems.length < requestLimit && hasMorePages && scannedTracePages < 10) {
    const url = new URL(`${config.base_url.trim().replace(/\/$/, "")}/api/public/traces`);
    url.searchParams.append("page", String(currentTracePage));
    url.searchParams.append("limit", String(requestLimit));
    url.searchParams.append("orderBy", "timestamp.desc");
    if (startIso) url.searchParams.append("fromTimestamp", startIso);
    if (endIso) url.searchParams.append("toTimestamp", endIso);

    const payload = await fetchLangfuseJson(url);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    lastMeta = payload?.meta || null;
    scannedTracePages += 1;

    for (const row of rows) {
      const sourceFromMetadata = row?.metadata?.source_lang;
      const sourceFromInput =
        row?.input && typeof row.input === "object" ? row.input.source_lang : null;
      const sourceLang = String(sourceFromMetadata || sourceFromInput || "")
        .trim()
        .toLowerCase();
      if (sourceLang !== "en" && sourceLang !== "english") continue;

      const input = row?.input && typeof row.input === "object" ? row.input : {};
      englishItems.push({
        traceId: row?.id || null,
        sessionId: row?.sessionId || null,
        userId: row?.userId || null,
        sourceLang: (row?.metadata?.source_lang || input?.source_lang || "en").toLowerCase(),
        targetLang: row?.metadata?.target_lang || input?.target_lang || null,
        originalQuery: input?.query || input?.text || null,
        timestamp: row?.timestamp || null,
        name: row?.name || null,
      });

      if (englishItems.length >= requestLimit) break;
    }

    const totalPages = Number(lastMeta?.totalPages || 0);
    const pageFromMeta = Number(lastMeta?.page || currentTracePage);
    hasMorePages = totalPages > 0 ? pageFromMeta < totalPages : rows.length > 0;
    currentTracePage += 1;
  }

  return {
    items: englishItems,
    pagination: {
      page: safePage,
      limit: requestLimit,
      scannedTracePages,
      nextPage: hasMorePages ? currentTracePage : null,
      sourceMeta: lastMeta,
    },
  };
}

module.exports = {
  getPretranslatedQueries,
  getEnglishQueriesFromTraces,
};
