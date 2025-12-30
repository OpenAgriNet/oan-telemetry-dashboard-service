const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

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
  // ssl: {
  //   rejectUnauthorized: true,
  //   ca: fs.readFileSync(path.join(__dirname, 'certs', 'rds-global.pem')).toString()
  // }
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
