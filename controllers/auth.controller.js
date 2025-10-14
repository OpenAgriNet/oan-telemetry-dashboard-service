const jose = require("jose");
const secret = process.env.MY_PUBLIC_KEY;
async function authController(req, res, next) {
  try {
    const jwt = req.query.token;
    if (!jwt) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    const { payload, protectedHeader } = await jose.jwtDecrypt(jwt, secret);
    next();
  } catch (error) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
}

module.exports = authController;
