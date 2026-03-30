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

const publicKeyPem = process.env.MY_PUBLIC_KEY;

if (!publicKeyPem) {
  throw new Error("MY_PUBLIC_KEY not configured");
}

const formattedKey = publicKeyPem.replace(/\\n/g, '\n');

// Pre-import the RSA public key for RS256 verification
const publicKeyPromise = (async () => {
  const { importSPKI } = await getJoseModule();
  return importSPKI(formattedKey, "RS256");
})();

async function leaderboardAuthController(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const tokenFromHeader = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
    const jwt = tokenFromHeader;
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
