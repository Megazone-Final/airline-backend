const fs = require('node:fs');
const mysql = require('mysql2/promise');
const { Signer } = require('@aws-sdk/rds-signer');

const DEFAULT_DB_HOST =
  'rds-airline-mysql-main.cluster-cb8q4mm6485z.ap-northeast-2.rds.amazonaws.com';

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

function getDbHost(role = 'writer') {
  if (role === 'reader') {
    return process.env.DB_READER_HOST || process.env.DB_WRITER_HOST || process.env.DB_HOST || DEFAULT_DB_HOST;
  }

  return process.env.DB_WRITER_HOST || process.env.DB_HOST || DEFAULT_DB_HOST;
}

function getResolvedRole(role = 'writer') {
  if (role === 'reader' && getDbHost('reader') === getDbHost('writer')) {
    return 'writer';
  }

  return role;
}

function buildSslOptions(host) {
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

async function getIamAuthToken(role = 'writer') {
  const host = getDbHost(role);
  const signer = new Signer({
    hostname: host,
    port: Number(process.env.DB_PORT || 3306),
    username: process.env.DB_USER || 'auth_user',
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-northeast-2',
  });

  return signer.getAuthToken();
}

const activePools = {};
const currentPasswords = {};

function createPool(role, password) {
  const resolvedRole = getResolvedRole(role);
  currentPasswords[resolvedRole] = password;

  activePools[resolvedRole] = mysql.createPool({
    host: getDbHost(resolvedRole),
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'auth_user',
    password,
    database: process.env.DB_NAME || 'auth',
    ssl: buildSslOptions(getDbHost(resolvedRole)),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    authPlugins: isIamAuthEnabled()
      ? {
          mysql_clear_password: () => () => Buffer.from(`${currentPasswords[resolvedRole]}\0`),
        }
      : undefined,
  });

  return activePools[resolvedRole];
}

function getActivePool(role = 'writer') {
  const resolvedRole = getResolvedRole(role);

  if (!activePools[resolvedRole]) {
    createPool(resolvedRole, process.env.DB_PASSWORD || '');
  }

  return activePools[resolvedRole];
}

async function initPool(role = 'writer') {
  const resolvedRole = getResolvedRole(role);

  if (activePools[resolvedRole]) {
    return activePools[resolvedRole];
  }

  if (isIamAuthEnabled()) {
    const token = await getIamAuthToken(resolvedRole);
    const pool = createPool(resolvedRole, token);

    setInterval(async () => {
      try {
        const newToken = await getIamAuthToken(resolvedRole);
        currentPasswords[resolvedRole] = newToken;
        pool.pool.config.connectionConfig.password = newToken;
      } catch (err) {
        console.error(`Failed to refresh RDS IAM token for ${resolvedRole}:`, err);
      }
    }, 10 * 60 * 1000).unref();

    return pool;
  }

  return createPool(resolvedRole, process.env.DB_PASSWORD || '');
}

const writerPool = {
  query(...args) {
    return getActivePool('writer').query(...args);
  },
  execute(...args) {
    return getActivePool('writer').execute(...args);
  },
  getConnection(...args) {
    return getActivePool('writer').getConnection(...args);
  },
  end(...args) {
    const pool = activePools.writer;
    if (!pool) {
      return Promise.resolve();
    }

    return pool.end(...args);
  },
};

const readerPool = {
  query(...args) {
    return getActivePool('reader').query(...args);
  },
  execute(...args) {
    return getActivePool('reader').execute(...args);
  },
  getConnection(...args) {
    return getActivePool('reader').getConnection(...args);
  },
  end(...args) {
    const resolvedRole = getResolvedRole('reader');
    const pool = activePools[resolvedRole];
    if (!pool) {
      return Promise.resolve();
    }

    return pool.end(...args);
  },
};

async function initMySQL() {
  await initPool('writer');
  await writerPool.query('SELECT 1');

  if (getResolvedRole('reader') !== 'writer') {
    await initPool('reader');
    await readerPool.query('SELECT 1');
  }

  if (process.env.DB_AUTO_INIT === 'false') {
    return;
  }

  await writerPool.query(`
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
  await writerPool.query('SELECT 1');

  if (getResolvedRole('reader') !== 'writer') {
    await readerPool.query('SELECT 1');
  }
}

async function closeMySQL() {
  const pools = Object.values(activePools).filter(Boolean);
  const uniquePools = [...new Set(pools)];

  await Promise.all(uniquePools.map((pool) => pool.end()));
}

module.exports = {
  pool: writerPool,
  writerPool,
  readerPool,
  initMySQL,
  checkMySQL,
  closeMySQL,
};
