const Redis = require('ioredis');

const valkeyUrl = process.env.VALKEY_URL;
let valkey = null;

function buildRedisClient() {
  if (!valkeyUrl) {
    return null;
  }

  const redisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
    tls: valkeyUrl.startsWith('rediss') ? { checkServerIdentity: () => undefined } : undefined,
  };

  const client = new Redis(valkeyUrl, redisOptions);
  client.on('error', (err) => {
    if (err.message.includes('NOAUTH') || err.message.includes('WRONGPASS')) {
      console.warn('Valkey auth failed. Check VALKEY_URL credentials.');
      return;
    }
    console.error('Valkey error:', err.message);
  });

  return client;
}

function getValkeyClient() {
  if (!valkey) {
    valkey = buildRedisClient();
  }

  return valkey;
}

async function initValkey() {
  const client = getValkeyClient();
  if (!client) {
    console.warn('Valkey is not configured. Start in degraded mode.');
    return false;
  }

  try {
    if (client.status === 'wait') {
      await client.connect();
    }
    await client.ping();
    console.log('Valkey connected');
    return true;
  } catch (err) {
    console.error('Valkey connection failed, continuing startup:', err.message);
    return false;
  }
}

async function checkValkey() {
  const client = getValkeyClient();
  if (!client) {
    throw new Error('Valkey is not configured');
  }

  try {
    await client.ping();
    return true;
  } catch (err) {
    throw err;
  }
}

async function closeValkey() {
  const client = getValkeyClient();
  if (client && client.status !== 'end') {
    await client.quit();
  }
}

module.exports = { getValkeyClient, initValkey, checkValkey, closeValkey };
