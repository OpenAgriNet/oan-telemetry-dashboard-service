const { maskApiResponse } = require("../utils/piiMasking");

const SENSITIVE_ENDPOINT_PATTERNS = [
  /^\/v1\/questions(?:\/|$)/i,
  /^\/v1\/sessions(?:\/|$)/i,
  /^\/v1\/feedback(?:\/|$)/i,
  /^\/v1\/errors(?:\/|$)/i,
  /^\/v1\/calls(?:\/|$)/i,
  /^\/v1\/asr(?:\/|$)/i,
  /^\/v1\/tts(?:\/|$)/i,
  /^\/v1\/users(?:\/|$)/i,
  /^\/v1\/userss(?:\/|$)/i,
  /^\/v1\/devices(?:\/|$)/i,
  /^\/v1\/leaderboard(?:\/|$)/i,
];

function getRequestPath(req) {
  const source = req.originalUrl || req.url || "";
  return source.split("?")[0];
}

function shouldMaskRequest(req) {
  const path = getRequestPath(req);
  return SENSITIVE_ENDPOINT_PATTERNS.some((pattern) => pattern.test(path));
}

function shouldAttemptJsonParse(res, body) {
  if (typeof body !== "string") return false;

  const contentType = String(res.get("Content-Type") || "").toLowerCase();
  if (contentType.includes("application/json")) return true;

  const trimmed = body.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function piiMaskingMiddleware(req, res, next) {
  if (!shouldMaskRequest(req)) return next();
  if (res.locals.__piiMaskingWrapped) return next();

  res.locals.__piiMaskingWrapped = true;

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = (body) => originalJson(maskApiResponse(body));

  res.send = (body) => {
    if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
      return originalSend(maskApiResponse(body));
    }

    if (shouldAttemptJsonParse(res, body)) {
      try {
        const parsed = JSON.parse(body);
        return originalSend(JSON.stringify(maskApiResponse(parsed)));
      } catch (_) {
        // Fall through with original response if body is not valid JSON.
      }
    }

    return originalSend(body);
  };

  return next();
}

piiMaskingMiddleware.shouldMaskRequest = shouldMaskRequest;
piiMaskingMiddleware.SENSITIVE_ENDPOINT_PATTERNS = SENSITIVE_ENDPOINT_PATTERNS;

module.exports = piiMaskingMiddleware;
