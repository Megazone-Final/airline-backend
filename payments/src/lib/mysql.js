const mysql = require('mysql2/promise');
const { Signer } = require('@aws-sdk/rds-signer');

const rdsConfig = {
  region: 'ap-northeast-2',
  hostname: process.env.DB_HOST || 'proxy-1773710218895-rds-airline-mysql-main.proxy-cb8q4mm6485z.ap-northeast-2.rds.amazonaws.com',
  port: Number(process.env.DB_PORT || 3306),
  username: process.env.DB_USER || 'payment_user'
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
    database: process.env.DB_NAME || 'payments',
    port: rdsConfig.port,
    ssl: 'Amazon RDS'
  });
}

/**
 * DB 초기화 및 테이블 생성
 */
async function initMySQL() {
  try {
    // 공통 함수를 호출하여 연결을 가져옵니다.
    const connection = await getConnection();

    console.log(`✅ RDS Proxy 연결 및 IAM 인증 성공 (User: ${rdsConfig.username})`);

    // 테이블 생성 쿼리 수행
    await connection.query(`
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
async function executeQuery(sql, params) {
  const connection = await getConnection();
  const [rows] = await connection.execute(sql, params);
  await connection.end();
  return rows;
}

/**
 * 헬스 체크용 함수
 */
async function checkMySQL() {
  const conn = await getConnection();
  await conn.query('SELECT 1');
  await conn.end();
}

module.exports = {
  initMySQL,
  checkMySQL,
  pool: { query: executeQuery }
};