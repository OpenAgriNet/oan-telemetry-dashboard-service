const { webcrypto } = require("node:crypto");
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

let joseModulePromise = null;
function getJoseModule() {
  if (!joseModulePromise) {
    joseModulePromise = import("jose");
  }
  return joseModulePromise;
}

const keycloakIssuer = (
  process.env.KEYCLOAK_ISSUER_URL ||
  "https://auth-vistaar-dev.mahapocra.gov.in/realms/Vistaar-dashboard"
).replace(/\/+$/, "");

let remoteJwksPromise = null;
async function getRemoteJwks() {
  if (!remoteJwksPromise) {
    remoteJwksPromise = getJoseModule().then(({ createRemoteJWKSet }) =>
      createRemoteJWKSet(new URL(`${keycloakIssuer}/protocol/openid-connect/certs`))
    );
  }
  return remoteJwksPromise;
}

async function authController(req, res, next) {
  try {
    if (process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_AUTH_BYPASS === "true") {
      req.user = { preferred_username: "local-evaluation", realm_access: { roles: ["super-admin"] } };
      return next();
    }

    const authHeader = req.headers.authorization || "";
    const tokenFromHeader = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const jwt = tokenFromHeader || req.query.token;
    if (!jwt) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const remoteJwks = await getRemoteJwks();
    const { jwtVerify } = await getJoseModule();
    const { payload } = await jwtVerify(jwt, remoteJwks, {
      algorithms: ["RS256"],
      issuer: keycloakIssuer,
    });

    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
}

module.exports = authController;
