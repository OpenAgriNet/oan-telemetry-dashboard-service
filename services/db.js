const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.UNIQUE_NAME_PG_USER,
  password: process.env.UNIQUE_NAME_PG_PASSWD,
  host: process.env.UNIQUE_NAME_PG_HOST,
  port: process.env.UNIQUE_NAME_PG_PORT,
  database: process.env.UNIQUE_NAME_PG_DB,
  ssl: process.env.UNIQUE_NAME_PG_SSL === 'true'
});

module.exports = pool;
