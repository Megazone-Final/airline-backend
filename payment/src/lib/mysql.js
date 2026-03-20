const mysql = require('mysql2/promise');
const { Signer } = require('@aws-sdk/rds-signer');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const rdsConfig = {
  region: requiredEnv('AWS_REGION'),
  hostname: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  username: requiredEnv('DB_USER'),
};

const signer = new Signer(rdsConfig);

/**
 * IAM 토큰을 생성하고 DB 연결 객체를 반환하는 공통 함수
 * (중복 코드를 줄이고 보안 설정을 일원화합니다)
 */
async function getConnection() {
  const token = await signer.getAuthToken();
  return await mysql.createConnection({
    host: rdsConfig.hostname,
    user: rdsConfig.username,
    password: token,
    database: requiredEnv('DB_NAME'),
    port: rdsConfig.port,
    ssl: 'Amazon RDS',
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
    const connection = await getConnection();

    console.log(`✅ RDS IAM 인증 성공 (${rdsConfig.hostname}, user: ${rdsConfig.username})`);

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

    console.log('✅ payments 테이블 확인 완료');
    await connection.end();
  } catch (err) {
    console.error('❌ DB 초기화 실패:', err.message);
    throw err;
  }
}

/**
 * 쿼리 실행용 헬퍼 함수
 */
async function runWithConnection(method, sql, params) {
  const connection = await getConnection();
  try {
    return await connection[method](sql, params);
  } finally {
    await connection.end();
  }
}

async function executeQuery(sql, params) {
  return runWithConnection('query', sql, params);
}

async function executeStatement(sql, params) {
  return runWithConnection('execute', sql, params);
}

/**
 * 헬스 체크용 함수
 */
async function checkMySQL() {
  const conn = await getConnection();
  await conn.query('SELECT 1');
  await conn.end();
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
};
