const jose = require("jose");
const publicKeyPem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6cqy+hechjriXqjWRe/a
nHyk76Iz4x7SpE06jioTaaXpp9kn9/cyVMkJmclN6QZUB7eLyIRTEPZhjr89IFBf
/Fsp/dRcfJZa98y87o5KEoSnZwviwDe6cjKA6b8iDNeOnhEeSVwddD6YVeAv9f9Z
oRkHDtnheNOs0FJoXEryW4mA0QWrq3We79D5hIUPlAkcocwEDhx6CQVm3ZOl8qnI
pz67N0qOiLiXFrEw/BaEFtpYEfilMGmLAc5DLpsE3P8v198yB3J6OStNfs3solKn
gc+4HxCOvHaPqLar11tBNaaMKXcyHOa6Sl5uJR7CZZBwqoIFFlrEhTxpPNwRxe6+
6QIDAQAB
-----END PUBLIC KEY-----`;
// Pre-import the RSA public key for RS256 verification
const publicKeyPromise = jose.importSPKI(publicKeyPem, "RS256");
async function authController(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const tokenFromHeader = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const jwt = tokenFromHeader || req.query.token;
    if (!jwt) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const publicKey = await publicKeyPromise;
    const { payload } = await jose.jwtVerify(jwt, publicKey, {
      algorithms: ["RS256"],
    });

    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
}

module.exports = authController;
