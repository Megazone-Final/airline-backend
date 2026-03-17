const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'rds-airline-mysql-main.cluster-cb8q4mm6485z.ap-northeast-2.rds.amazonaws.com',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'auth_user',
  database: process.env.DB_NAME || 'auth',
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
});

async function initMySQL() {
  await pool.query('SELECT 1');

  if (process.env.DB_AUTO_INIT === 'false') {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY users_email_unique (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function checkMySQL() {
  await pool.query('SELECT 1');
}

async function closeMySQL() {
  await pool.end();
}

module.exports = {
  pool,
  initMySQL,
  checkMySQL,
  closeMySQL,
};
