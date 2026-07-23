const axios = require("axios");

function client() {
  const baseURL = String(process.env.EVALUATION_WORKER_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.EVALUATION_SERVICE_KEY;
  if (!baseURL || !serviceKey) throw new Error("Evaluation worker is not configured");
  return axios.create({
    baseURL,
    timeout: 15000,
    headers: { "x-evaluation-service-key": serviceKey },
  });
}

async function listModels() {
  const response = await client().get("/models");
  return response.data?.data || [];
}

async function startRun(body) {
  const response = await client().post("/runs", body);
  return response.data?.data;
}

module.exports = { listModels, startRun };
