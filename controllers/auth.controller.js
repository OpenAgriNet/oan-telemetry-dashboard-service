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
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAj9khR1mDDVGK7ZMQU7O5
bCYinMmt1/J2Ur+i2d4a99on6wJnPtTu9hIPS3X/0krwSjivfkuKYsEaZ+hge/aL
OlLCJwUC8JcKDgosAbwHGixExbLvZyD9M1CJggbsjVtWfONIerg0OLirfvKRsqKi
VvB9jxGMwEcbJu4iqP7RMx+Lvxq8nTSUPt/npQz3Bxy+OQSzItiB8iQLPjKnELjt
F1s2F4/r8YLwvLNZH6OVi78TzNVG0VNFV7FOVkWb9U1wqn5UbomhFT7lOE2CVMfD
F+g24K2NFAbgQLtHfURMQ6FEAFFEFb9pEMco7vD6y5NCIfHr4uBx2axB35oPEzEv
VQIDAQAB
-----END PUBLIC KEY-----`;
// Pre-import the RSA public key for RS256 verification
const publicKeyPromise = (async () => {
  const { importSPKI } = await getJoseModule();
  return importSPKI(publicKeyPem, "RS256");
})();
async function authController(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const tokenFromHeader = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const jwt = tokenFromHeader || req.query.token;
    if (!jwt) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const publicKey = await publicKeyPromise;
    const { jwtVerify } = await getJoseModule();
    const { payload } = await jwtVerify(jwt, publicKey, {
      algorithms: ["RS256"],
    });

    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
}

module.exports = authController;
