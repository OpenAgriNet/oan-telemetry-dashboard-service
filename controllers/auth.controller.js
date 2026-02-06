const { createAuthMiddleware } = require("../lib/jwksAuth");

const authController = createAuthMiddleware();

module.exports = authController;
