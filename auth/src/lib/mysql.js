const mysqlCore = require('mysql2');
const mysql = require('mysql2/promise');
const { Signer } = require('@aws-sdk/rds-signer');

const host =
  process.env.DB_HOST || 'rds-airline-mysql-main.cluster-cb8q4mm6485z.ap-northeast-2.rds.amazonaws.com';
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.DB_USER || 'auth_user';
const database = process.env.DB_NAME || 'auth';
const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 10);
const useIamAuth =
  process.env.DB_USE_IAM_AUTH === 'true' || process.env.DB_AUTH_MODE === 'iam';
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-northeast-2';

const signer = useIamAuth
  ? new Signer({
      hostname: host,
      port,
      username: user,
      region,
    })
  : null;

const standardPool = useIamAuth
  ? null
  : mysql.createPool({
      host,
      port,
      user,
      password: process.env.DB_PASSWORD || '',
      database,
      waitForConnections: true,
      connectionLimit,
      queueLimit: 0,
    });

async function getIamConnection() {
  const token = await signer.getAuthToken();

  return mysql.createConnection({
    host,
    port,
    user,
    password: token,
    database,
    ssl: 'Amazon RDS',
    authPlugins: {
      mysql_clear_password: mysqlCore.authPlugins.mysql_clear_password({
        password: token,
      }),
    },
  });
}

async function withConnection(handler) {
  if (!useIamAuth) {
    return handler(standardPool);
  }

  const connection = await getIamConnection();

  try {
    return await handler(connection);
  } finally {
    await connection.end();
  }
}

const pool = {
  query(sql, params) {
    return withConnection((connection) => connection.query(sql, params));
  },
  execute(sql, params) {
    return withConnection((connection) => connection.execute(sql, params));
  },
  async end() {
    if (standardPool) {
      await standardPool.end();
    }
  },
};

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
