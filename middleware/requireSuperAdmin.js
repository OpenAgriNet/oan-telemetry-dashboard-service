function requireSuperAdmin(req, res, next) {
  const roles = req.user?.realm_access?.roles || [];
  if (!roles.includes("super-admin")) {
    return res.status(403).json({ success: false, message: "Super-admin access is required" });
  }
  next();
}

module.exports = requireSuperAdmin;
