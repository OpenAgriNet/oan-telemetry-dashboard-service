const jose = require("jose");
async function authController(req, res, next) {
  try {
    const secret = process.env.MY_PUBLIC_KEY;

    const jwt = req.query.token;
    if (!jwt) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const { payload, protectedHeader } = await jose.jwtDecrypt(jwt, secret);
    next();
  } catch (error) {
    res.status(401).json({ status: "error", message: "Unauthorized" });
  }
}

module.exports = authController;
