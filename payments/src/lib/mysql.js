const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'airline_payments',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
});

async function initMySQL() {
  await pool.query('SELECT 1');

  if (process.env.DB_AUTO_INIT === 'false') {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(32) NOT NULL PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      reservation_id VARCHAR(32) NOT NULL,
      flight_id BIGINT UNSIGNED NOT NULL,
      amount INT NOT NULL,
      method VARCHAR(100) NOT NULL,
      status VARCHAR(30) NOT NULL,
      travel_date DATE NOT NULL,
      passenger_count INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY payments_user_idx (user_id, created_at)
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
