const Redis = require('ioredis');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const valkeyUrl = requiredEnv('VALKEY_URL');

const redisOptions = {
  lazyConnect: true,
  // 중요: 재시도 횟수를 제한하여 로그 폭발 방지
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) return null; // 3번 실패하면 재시도 포기
    return Math.min(times * 200, 2000);
  },
  // 전송 중 암호화(TLS) 활성화를 위해 필수 (rediss:// 대응)
  tls: (valkeyUrl && valkeyUrl.startsWith('rediss')) ? { checkServerIdentity: () => undefined } : undefined,
};

const valkey = new Redis(valkeyUrl, redisOptions);

// 에러 이벤트 핸들러 추가 (로그 도배 방지)
valkey.on('error', (err) => {
  if (err.message.includes('NOAUTH')) {
    // 비밀번호 문제일 때는 한 줄만 출력
    console.warn('⚠️ Valkey Auth 필요: 비밀번호를 확인하세요.');
  }
});

async function initValkey() {
  try {
    if (valkey.status === 'wait') {
      await valkey.connect();
    }
    const pong = await valkey.ping();
    if (pong === 'PONG') {
      console.log('✅ Valkey(Redis) 연결 및 TLS 핸드셰이크 성공');
    }
  } catch (err) {
    // throw err; 를 주석처리하여 DB(MySQL)가 성공했다면 앱은 뜨게 만듭니다.
    console.error('❌ Valkey 연결 실패 (무시하고 앱 기동):', err.message);
  }
}

async function checkValkey() {
  try {
    await valkey.ping();
    return true;
  } catch (err) {
    return false;
  }
}

async function closeValkey() {
  if (valkey.status !== 'end') {
    await valkey.quit();
    console.log('💤 Valkey 연결이 안전하게 종료되었습니다.');
  }
}

module.exports = { valkey, initValkey, checkValkey, closeValkey };
