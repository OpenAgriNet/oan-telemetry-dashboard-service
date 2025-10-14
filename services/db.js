const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "5432", 10),
  // ssl: {
  //   rejectUnauthorized: true,
  //   ca: fs.readFileSync(path.join(__dirname, 'certs', 'rds-global.pem')).toString()
  // }
});


// const pool = new Pool({
//   user: process.env.DB_USER,
//   host: process.env.DB_HOST,
//   database: process.env.DB_NAME,  
//   password: process.env.DB_PASSWORD,
//   port: parseInt(process.env.DB_PORT || "5432", 10),
//   ssl: {
//     rejectUnauthorized: true,
//     ca: fs.readFileSync(path.join(__dirname, '..', 'certs', 'rds-global.pem')).toString()
//   }
// });

module.exports = pool;
