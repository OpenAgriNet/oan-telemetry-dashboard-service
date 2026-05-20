const { LangfuseConfig: config } = require("./config.js");

const authString = `${config.public_key}:${config.secret_key}`;
const encodedAuth = Buffer.from(authString).toString("base64");
const lfHeaders = new Headers();
lfHeaders.append("Authorization", `Basic ${encodedAuth}`);

async function getTotalUsers(from, to) {
  const query = JSON.stringify({
    view: "traces",
    metrics: [{ measure: "count", aggregation: "count" }],
    dimensions: [{ field: "userId" }],
    // filter: [
    //   {
    //     column: "environment",
    //     operator: "=",
    //     value: "chat-production",
    //     type: "string",
    //   },
    // ],
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
      return data.data.length;
    })
    .catch((error) => console.log(error));
}

module.exports = { getTotalUsers };
