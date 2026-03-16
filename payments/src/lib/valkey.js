const Redis = require('ioredis');

const valkey = process.env.VALKEY_URL
  ? new Redis(process.env.VALKEY_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    })
  : new Redis({
      host: process.env.VALKEY_HOST || 'localhost',
      port: Number(process.env.VALKEY_PORT || 6379),
      password: process.env.VALKEY_PASSWORD || undefined,
      db: Number(process.env.VALKEY_DB || 0),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

async function initValkey() {
  if (valkey.status === 'wait') {
    await valkey.connect();
  }

  await valkey.ping();
}

async function checkValkey() {
  await valkey.ping();
}

async function closeValkey() {
  if (valkey.status === 'ready') {
    await valkey.quit();
  }
}

module.exports = {
  valkey,
  initValkey,
  checkValkey,
  closeValkey,
};
