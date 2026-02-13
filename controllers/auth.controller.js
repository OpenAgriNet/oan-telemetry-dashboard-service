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
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAhTdqS1xhKPDQhMJ8PjVi
R94+qePsjOB+v7qdAK9/ytLeU/3x6kIZ6ki1lAAaOWY3ZvlS/yF6l8xt4op5k+Yy
5Sh1k1DF92H/rmtZ63Rf3SC23pV91C/uYLOGxGLfXh3G5CbmnAfiaMF185HwTJ+i
ej4ntdyg+5QKYi5L6V/zynD25UpQ9Nb60JXdJbk19Susfvos9c4VJKVUdB22iXRq
TVEkEmhrNVkr/uS7/baJf896rklFg4ZWhKTo0TxqQNOdGbX8dHrJZIGMku2Fqp8Z
BwoQ8AHx0SsjYzmUZ9YYLe/yhN7VpPVv3flLEUU+bRWTXuvbrrnxS+DuyJEMluFJ
9QIDAQAB
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
