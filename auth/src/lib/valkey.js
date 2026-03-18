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
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
  tls: valkeyUrl.startsWith('rediss') ? { checkServerIdentity: () => undefined } : undefined,
};

const valkey = new Redis(valkeyUrl, redisOptions);

valkey.on('error', (err) => {
  if (err.message.includes('NOAUTH')) {
    console.warn('Valkey auth required: check credentials.');
  }
});

async function initValkey() {
  try {
    if (valkey.status === 'wait') {
      await valkey.connect();
    }
    const pong = await valkey.ping();
    if (pong === 'PONG') {
      console.log('Valkey connected');
    }
  } catch (err) {
    console.error('Valkey connection failed, continuing startup:', err.message);
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
  }
}

module.exports = {
  valkey,
  initValkey,
  checkValkey,
  closeValkey,
};
