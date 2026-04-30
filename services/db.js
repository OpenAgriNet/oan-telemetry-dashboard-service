const { Pool } = require("pg");

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "5432", 10),
  // tune these values to your infra; reasonable defaults shown
  max: parseInt(process.env.DB_POOL_MAX || "20", 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || "30000", 10),
  connectionTimeoutMillis: parseInt(
    process.env.DB_CONN_TIMEOUT_MS || "5000",
    10
  ),
  // Apply global query guards so long-running analytics are not cut off by
  // implicit/default 30s limits in some environments.
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || "120000", 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "120000", 10),
  ssl: {
    rejectUnauthorized: false
  }
});

// Prevent unhandled pool errors from crashing the process
pool.on("error", (err, client) => {
  console.error(
    "Unexpected pg pool error — client will be closed",
    err?.code || err?.message || err
  );
  // you can send metrics/alerts here
});

module.exports = pool;
