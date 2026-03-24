const Redis = require('ioredis');
const { createLogger } = require('./logger');

const valkeyUrl = process.env.VALKEY_URL;
let valkey = null;
const logger = createLogger('payment');

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
      logger.warn('Valkey authentication failed', {
        event: 'valkey_auth_failed',
        category: 'configuration',
        reason: 'invalid_credentials',
        context: { dependency: 'valkey' },
        error: err,
      });
      return;
    }
    logger.warn('Valkey runtime error detected', {
      event: 'valkey_runtime_error',
      category: 'external_dependency',
      reason: 'runtime_error',
      context: { dependency: 'valkey' },
      error: err,
    });
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
    logger.warn('Valkey is not configured, payment service starts in degraded mode', {
      event: 'valkey_unavailable',
      category: 'configuration',
      reason: 'missing_configuration',
      context: { dependency: 'valkey' },
    });
    return false;
  }

  try {
    if (client.status === 'wait') {
      await client.connect();
    }
    await client.ping();
    logger.info('Valkey connected', {
      event: 'valkey_connected',
      category: 'external_dependency',
      context: { dependency: 'valkey' },
    });
    return true;
  } catch (err) {
    logger.warn('Valkey connection failed, payment service continues in degraded mode', {
      event: 'valkey_connection_failed',
      category: 'external_dependency',
      reason: 'connection_failed',
      context: { dependency: 'valkey' },
      error: err,
    });
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
