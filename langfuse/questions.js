const { LangfuseConfig: config } = require("./config.js");

const authString = `${config.public_key}:${config.secret_key}`;
const encodedAuth = Buffer.from(authString).toString("base64");
const lfHeaders = new Headers();
lfHeaders.append("Authorization", `Basic ${encodedAuth}`);

async function getTotalVoiceQuestions(from, to) {
  const query = JSON.stringify({
    view: "traces",
    metrics: [{ measure: "count", aggregation: "count" }],
    dimensions: [{ field: "name" }],
    ...(from !== null && { fromTimestamp: from }),
    ...(to !== null && { toTimestamp: to }),
    orderBy: [{ field: "count_count", direction: "desc" }],
  });
  const url = new URL(`${config.base_url.trim()}/api/public/metrics`);
  url.searchParams.append("query", query);
  return fetch(url, {
    method: "GET",
    headers: lfHeaders,
    redirect: "follow",
  })
    .then(async (response) => {
      const data = await response.json();
      if (response.status !== 200) {
        throw new Error(`Failed to fetch data due to error: ${data.message}`);
      }
      let total = 0;
      for (const value of data.data) {
        if (
          value.name === "Voice Agent run" ||
          value.name === "Voice Agent Signed In run" ||
          value.name === "Amul AI Agent"
        ) {
          total += parseInt(value.count_count);
        }
      }
      return total;
    })
    .catch((error) => console.log(error));
}

async function getTotalChatQuestions(from, to) {
  const query = JSON.stringify({
    view: "traces",
    metrics: [{ measure: "count", aggregation: "count" }],
    dimensions: [],
    filters: [
      {
        column: "metadata",
        operator: "contains",
        key: "attributes",
        value: "Amul AI Agent",
        type: "stringObject",
      },
    ],
    ...(from !== null && { fromTimestamp: from }),
    ...(to !== null && { toTimestamp: to }),
  });
  const url = new URL(`${config.base_url.trim()}/api/public/metrics`);
  url.searchParams.append("query", query);
  return fetch(url, {
    method: "GET",
    headers: lfHeaders,
    redirect: "follow",
  })
    .then(async (response) => {
      const data = await response.json();
      if (response.status !== 200) {
        throw new Error(`Failed to fetch data due to error: ${data.message}`);
      }
      return parseInt(data.data[0].count_count);
    })
    .catch((error) => console.log(error));
}

async function getTotalQuestions(from, to) {
  const [totalVoiceQuestions, totalChatQuestions] = await Promise.all([
    getTotalVoiceQuestions(from, to),
    getTotalChatQuestions(from, to),
  ]);
  return totalChatQuestions + totalVoiceQuestions;
}

module.exports = { getTotalQuestions };
