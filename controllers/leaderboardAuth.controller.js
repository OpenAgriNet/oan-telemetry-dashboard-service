const { createAuthMiddleware } = require("../lib/jwksAuth");

function postVerify(payload, req) {
  let registeredLgd = null;
  if (Array.isArray(payload.locations)) {
    const regLoc = payload.locations.find(
      (l) => l && l.location_type === "registered_location"
    );
    if (regLoc && regLoc.lgd_code !== undefined && regLoc.lgd_code !== "") {
      registeredLgd = regLoc.lgd_code;
    }
  }
  req.user.registered_lgd_code = registeredLgd;
  req.registeredLgdCode = registeredLgd;
}

const leaderboardAuthController = createAuthMiddleware({ postVerify });

module.exports = leaderboardAuthController;
