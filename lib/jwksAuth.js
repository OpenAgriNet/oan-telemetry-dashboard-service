const { webcrypto } = require("node:crypto");
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

let joseModulePromise = null;
async function getJose() {
  if (!joseModulePromise) {
    joseModulePromise = import("jose");
  }
  return joseModulePromise;
}

function getJwksUrl() {
  const uri = process.env.KEYCLOAK_JWKS_URI;
  if (uri) return uri;
  const url = (process.env.KEYCLOAK_URL || "").replace(/\/$/, "");
  const realm = process.env.KEYCLOAK_REALM || "";
  if (!url || !realm) return null;
  return `${url}/realms/${realm}/protocol/openid-connect/certs`;
}

let jwksPromise = null;
async function getJwks() {
  if (!jwksPromise) {
    const url = getJwksUrl();
    if (!url) {
      throw new Error(
        "KEYCLOAK_JWKS_URI or both KEYCLOAK_URL and KEYCLOAK_REALM must be set"
      );
    }
    const jose = await getJose();
    jwksPromise = jose.createRemoteJWKSet(new URL(url));
  }
  return jwksPromise;
}

/**
 * Creates an auth middleware that verifies JWT via Keycloak JWKS.
 * @param {Object} [options]
 * @param {function(payload, req): void} [options.postVerify] - Called after verification to add custom logic (e.g. extract lgd_code)
 */
function createAuthMiddleware(options = {}) {
  const { postVerify } = options;

  return async function authMiddleware(req, res, next) {
    try {
      const authHeader = req.headers.authorization || "";
      const tokenFromHeader = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;
      const jwt = tokenFromHeader || req.query.token;
      if (!jwt) {
        return res.status(401).json({ status: "error", message: "Unauthorized" });
      }

      const JWKS = await getJwks();
      const { jwtVerify } = await getJose();
      const { payload } = await jwtVerify(jwt, JWKS, {
        algorithms: ["RS256"],
      });

      req.user = payload;
      if (typeof postVerify === "function") {
        postVerify(payload, req);
      }
      next();
    } catch (error) {
      console.error("Auth error:", error.code || error.message);
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
  };
}

// Startup check – log whether JWKS config is present
(function checkJwksConfig() {
  const url = getJwksUrl();
  if (url) {
    console.log(`[jwksAuth] JWKS endpoint configured: ${url}`);
  } else {
    console.error(
      "[jwksAuth] JWKS endpoint NOT configured. Set KEYCLOAK_JWKS_URI or both KEYCLOAK_URL and KEYCLOAK_REALM. Auth will fail."
    );
  }
})();

module.exports = { createAuthMiddleware, getJwks, getJwksUrl };
