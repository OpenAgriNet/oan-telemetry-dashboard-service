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

const publicKeyPem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1LfVLPHCozMxH2Mo
4lgOEePzNm0tRgeLezV6ffAt0gunVTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u
+qKhbwKfBstIs+bMY2Zkp18gnTxKLxoS2tFczGkPLPgizskuemMghRniWaoLcyeh
kd3qqGElvW/VDL5AaWTg0nLVkjRo9z+40RQzuVaE8AkAFmxZzow3x+VJYKdjykkJ
0iT9wCS0DRTXu269V264Vf/3jvredZiKRkgwlL9xNAwxXFg0x/XFw005UWVRIkdg
cKWTjpBP2dPwVZ4WWC+9aGVd+Gyn1o0CLelf4rEjGoXbAAEgAqeGUxrcIlbjXfbc
mwIDAQAB
-----END PUBLIC KEY-----`;

// Pre-import the RSA public key for RS256 verification
const publicKeyPromise = (async () => {
  const { importSPKI } = await getJoseModule();
  return importSPKI(publicKeyPem, "RS256");
})();

async function leaderboardAuthController(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const tokenFromHeader = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
    const jwt = tokenFromHeader || req.query.token;
    if (!jwt) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const publicKey = await publicKeyPromise;
    const { jwtVerify } = await getJoseModule();
    const { payload } = await jwtVerify(jwt, publicKey, {
      algorithms: ["RS256"],
    });

    // Attach full payload as user
    req.user = payload;

    // Extract lgd_code from the registered_location (if present)
    let registeredLgd = null;
    if (Array.isArray(payload.locations)) {
      const regLoc = payload.locations.find(
        (l) => l && l.location_type === "registered_location"
      );
      if (regLoc && regLoc.lgd_code !== undefined && regLoc.lgd_code !== "") {
        registeredLgd = regLoc.lgd_code;
      }
    }

    // Expose for downstream handlers
    req.user.registered_lgd_code = registeredLgd;
    req.registeredLgdCode = registeredLgd;

    next();
  } catch (error) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
}

module.exports = leaderboardAuthController;
