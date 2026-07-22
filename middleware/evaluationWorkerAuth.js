function evaluationWorkerAuth(req, res, next) {
  const configuredKey = process.env.EVALUATION_SERVICE_KEY;
  const providedKey = req.get("x-evaluation-service-key");

  if (!configuredKey) {
    return res.status(503).json({ status: "error", message: "Evaluation worker authentication is not configured" });
  }
  if (!providedKey || providedKey !== configuredKey) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
  next();
}

module.exports = evaluationWorkerAuth;
