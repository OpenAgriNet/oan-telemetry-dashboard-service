const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// const pool = new Pool({
//   user: process.env.UNIQUE_NAME_PG_USER,
//   password: process.env.UNIQUE_NAME_PG_PASSWD,
//   host: process.env.UNIQUE_NAME_PG_HOST,
//   port: process.env.UNIQUE_NAME_PG_PORT,
//   database: process.env.UNIQUE_NAME_PG_DB,
//   ssl: process.env.UNIQUE_NAME_PG_SSL === 'true'
// });


const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "5432", 10),
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(path.join(__dirname, '..', 'certs', 'rds-global.pem')).toString()
  }
});

module.exports = pool;
