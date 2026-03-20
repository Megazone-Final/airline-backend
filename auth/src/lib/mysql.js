const fs = require('node:fs');
const mysql = require('mysql2/promise');
const { Signer } = require('@aws-sdk/rds-signer');

function parseBoolean(value) {
  if (value == null) {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function isIamAuthEnabled() {
  const legacyFlag = parseBoolean(process.env.DB_USE_IAM_AUTH);
  const flag = parseBoolean(process.env.DB_IAM_AUTH);
  const mode = String(process.env.DB_AUTH_MODE || '').trim().toLowerCase();

  return flag ?? legacyFlag ?? mode === 'iam';
}

function buildSslOptions() {
  const host =
    process.env.DB_HOST || 'rds-airline-mysql-main.cluster-cb8q4mm6485z.ap-northeast-2.rds.amazonaws.com';
  const sslFlag = parseBoolean(process.env.DB_SSL);
  const sslMode = String(process.env.DB_SSL_MODE || '').trim().toLowerCase();

  if (sslFlag === false || sslMode === 'disabled') {
    return undefined;
  }

  const shouldUseSsl =
    sslFlag === true ||
    ['preferred', 'required', 'verify_ca', 'verify_identity'].includes(sslMode) ||
    host.endsWith('.rds.amazonaws.com');

  if (!shouldUseSsl) {
    return undefined;
  }

  const ssl = {};
  const caPath = process.env.DB_SSL_CA_PATH;
  const caValue = process.env.DB_SSL_CA;
  const rejectUnauthorized = parseBoolean(process.env.DB_SSL_REJECT_UNAUTHORIZED);

  if (caPath) {
    ssl.ca = fs.readFileSync(caPath, 'utf8');
  } else if (caValue) {
    ssl.ca = caValue.replace(/\\n/g, '\n');
  }

  if (rejectUnauthorized !== undefined) {
    ssl.rejectUnauthorized = rejectUnauthorized;
  }

  return ssl;
}

async function getIamAuthToken() {
  const signer = new Signer({
    hostname:
      process.env.DB_HOST || 'rds-airline-mysql-main.cluster-cb8q4mm6485z.ap-northeast-2.rds.amazonaws.com',
    port: Number(process.env.DB_PORT || 3306),
    username: process.env.DB_USER || 'auth_user',
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-northeast-2',
  });

  return signer.getAuthToken();
}

let activePool;
let currentPassword = process.env.DB_PASSWORD || '';

function createPool(password) {
  currentPassword = password;
  activePool = mysql.createPool({
    host:
      process.env.DB_HOST || 'rds-airline-mysql-main.cluster-cb8q4mm6485z.ap-northeast-2.rds.amazonaws.com',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'auth_user',
    password,
    database: process.env.DB_NAME || 'auth',
    ssl: buildSslOptions(),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    authPlugins: isIamAuthEnabled()
      ? {
        mysql_clear_password: () => (data) => {
          return Buffer.from(currentPassword + '\0');
        }
      }
      : undefined,
  });


  return activePool;
}

function getActivePool() {
  if (!activePool) {
    createPool(process.env.DB_PASSWORD || '');
  }

  return activePool;
}

const pool = {
  query(...args) {
    return getActivePool().query(...args);
  },
  execute(...args) {
    return getActivePool().execute(...args);
  },
  getConnection(...args) {
    return getActivePool().getConnection(...args);
  },
  end(...args) {
    if (!activePool) {
      return Promise.resolve();
    }

    return activePool.end(...args);
  },
};

async function initMySQL() {
  if (isIamAuthEnabled()) {
    const token = await getIamAuthToken();
    createPool(token);

    setInterval(async () => {
      try {
        const newToken = await getIamAuthToken();
        const currentPool = getActivePool();
        currentPassword = newToken;
        currentPool.pool.config.connectionConfig.password = newToken;
      } catch (err) {
        console.error('Failed to refresh RDS IAM token:', err);
      }
    }, 10 * 60 * 1000).unref();
  } else {
    createPool(process.env.DB_PASSWORD || '');
  }

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
