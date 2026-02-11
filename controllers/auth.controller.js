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
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAj4R4rkOZlN6M7+DDkwlh
QNS7ZThhpwG3r7eCghUqhqvham25dxWq8Wm9vNJijCvWnWbCjavWWIvz6jzBbCfe
Y0zSYy+hEn14PFurZizQ1QVoD6RzU1zxI9h/jnNULfmFifW3JYnuckQzM42bI38u
/97Whi1xb+/vp+k52H2pWnh+yHJQKTIi3ZzFOv+gb08Lukg7gJ5wCQ+t1hSxjzBZ
8968fCjkFdNXtU80sX1KEVkHpJkP4eymVqtkMvDn4TEfajTRKc+HrP6u4QX/UIdP
oRwAwDQD+fFncTBbyc/ld5ddxwZGan0gL8ona9CjujI+Yz3+FhRTtFpFU4jTxE2F
cQIDAQAB
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
