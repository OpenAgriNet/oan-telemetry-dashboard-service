const TELEMETRY_DETAIL_ROLE = "telemetry-detail-viewer";

function requireTelemetryDetail(req, res, next) {
  const roles = req.user?.realm_access?.roles;
  if (!Array.isArray(roles) || !roles.includes(TELEMETRY_DETAIL_ROLE)) {
    return res.status(403).json({
      success: false,
      message: "The telemetry-detail-viewer role is required",
    });
  }
  next();
}

module.exports = requireTelemetryDetail;
