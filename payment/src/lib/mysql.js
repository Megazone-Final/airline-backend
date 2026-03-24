const fs = require('node:fs');
const mysql = require('mysql2/promise');
const { Signer } = require('@aws-sdk/rds-signer');
const { createLogger } = require('./logger');

const logger = createLogger('payment');

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

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function getDbHost(role = 'writer') {
  if (role === 'reader') {
    return process.env.DB_READER_HOST || process.env.DB_WRITER_HOST || process.env.DB_HOST || missingDbHost(role);
  }

  return process.env.DB_WRITER_HOST || process.env.DB_HOST || missingDbHost(role);
}

function missingDbHost(role) {
  throw new Error(
    role === 'reader'
      ? 'Missing required env: DB_READER_HOST or DB_WRITER_HOST or DB_HOST'
      : 'Missing required env: DB_WRITER_HOST or DB_HOST'
  );
}

function getBaseConfig() {
  return {
    region: requiredEnv('AWS_REGION'),
    port: Number(process.env.DB_PORT || 3306),
    username: requiredEnv('DB_USER'),
  };
}

function isProxyHost(host) {
  return host.includes('.proxy-');
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

  // RDS Proxy presents ACM certificates, so use the system trust store unless
  // a non-proxy endpoint explicitly needs the RDS bundle.
  if (!isProxyHost(host)) {
    if (caPath) {
      ssl.ca = fs.readFileSync(caPath, 'utf8');
    } else if (caValue) {
      ssl.ca = caValue.replace(/\\n/g, '\n');
    }
  }

  if (rejectUnauthorized !== undefined) {
    ssl.rejectUnauthorized = rejectUnauthorized;
  }

  return ssl;
}

/**
 * IAM 토큰을 생성하고 DB 연결 객체를 반환하는 공통 함수
 * (중복 코드를 줄이고 보안 설정을 일원화합니다)
 */
async function getConnection(role = 'writer') {
  const baseConfig = getBaseConfig();
  const hostname = getDbHost(role);
  const signer = new Signer({
    ...baseConfig,
    hostname,
  });
  const token = await signer.getAuthToken();

  return await mysql.createConnection({
    host: hostname,
    user: baseConfig.username,
    password: token,
    database: requiredEnv('DB_NAME'),
    port: baseConfig.port,
    ssl: buildSslOptions(hostname),
    authPlugins: {
      mysql_clear_password: () => () => Buffer.from(`${token}\0`),
    },
  });
}

/**
 * DB 초기화 및 테이블 생성
 */
async function initMySQL() {
  try {
    const connection = await getConnection('writer');

    logger.info('RDS IAM authentication succeeded', {
      event: 'rds_iam_authenticated',
      category: 'database',
      context: {
        host: getDbHost('writer'),
        user: getBaseConfig().username,
      },
    });

    await connection.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id VARCHAR(32) NOT NULL PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        reservation_id VARCHAR(32) NULL,
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

    await connection.query(`
      ALTER TABLE payments
      MODIFY COLUMN reservation_id VARCHAR(32) NULL
    `);

    logger.info('Payments table is ready', {
      event: 'payments_table_ready',
      category: 'database',
    });
    await connection.end();
  } catch (err) {
    logger.error('Payment database initialization failed', {
      event: 'database_init_failed',
      category: 'database',
      error: err,
    });
    throw err;
  }
}

/**
 * 쿼리 실행용 헬퍼 함수
 */
async function runWithConnection(role, method, sql, params) {
  const connection = await getConnection(role);
  try {
    return await connection[method](sql, params);
  } finally {
    await connection.end();
  }
}

async function executeQuery(sql, params) {
  return runWithConnection('writer', 'query', sql, params);
}

async function executeStatement(sql, params) {
  return runWithConnection('writer', 'execute', sql, params);
}

async function executeReadQuery(sql, params) {
  return runWithConnection('reader', 'query', sql, params);
}

async function executeReadStatement(sql, params) {
  return runWithConnection('reader', 'execute', sql, params);
}

/**
 * 헬스 체크용 함수
 */
async function checkMySQL() {
  const writer = await getConnection('writer');
  await writer.query('SELECT 1');
  await writer.end();

  if (getDbHost('reader') !== getDbHost('writer')) {
    const reader = await getConnection('reader');
    await reader.query('SELECT 1');
    await reader.end();
  }

  return true;
}

async function closeMySQL() {
  return Promise.resolve();
}

module.exports = {
  initMySQL,
  checkMySQL,
  closeMySQL,
  pool: {
    query: executeQuery,
    execute: executeStatement,
  },
  writerPool: {
    query: executeQuery,
    execute: executeStatement,
  },
  readerPool: {
    query: executeReadQuery,
    execute: executeReadStatement,
  },
};
