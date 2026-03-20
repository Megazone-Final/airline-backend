const Redis = require('ioredis');

function parseBoolean(value) {
  if (value == null) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const valkeyUrl = process.env.VALKEY_URL;
const useIamAuth = parseBoolean(process.env.VALKEY_USE_IAM_AUTH) ?? false;
const tlsEnabled = parseBoolean(process.env.VALKEY_TLS) ?? false;
const userId = process.env.VALKEY_USER;
const clusterName = process.env.VALKEY_CLUSTER_NAME;
const region = process.env.AWS_REGION || 'ap-northeast-2';

function getLegacyHost() {
  return process.env.VALKEY_HOST;
}

function getLegacyPort() {
  return parseInt(process.env.VALKEY_PORT || '6379', 10);
}

function createRetryOptions() {
  return {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
  };
}

async function getIamToken() {
  if (!clusterName || !userId) {
    throw new Error('VALKEY IAM auth requires VALKEY_CLUSTER_NAME and VALKEY_USER');
  }

  const { SignatureV4 } = require('@smithy/signature-v4');
  const { Hash } = require('@smithy/hash-node');
  const { defaultProvider } = require('@aws-sdk/credential-provider-node');

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: 'elasticache',
    sha256: Hash.bind(null, 'sha256'),
  });

  const signed = await signer.presign(
    {
      method: 'GET',
      protocol: 'https:',
      hostname: clusterName,
      path: '/',
      query: {
        Action: 'connect',
        User: userId,
      },
      headers: { host: clusterName },
    },
    { expiresIn: 900 },
  );

  const qs = Object.entries(signed.query || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  return `https://${signed.hostname}${signed.path}?${qs}`;
}

function buildUrlClient() {
  if (!valkeyUrl) {
    return null;
  }

  return new Redis(valkeyUrl, {
    ...createRetryOptions(),
    tls: valkeyUrl.startsWith('rediss://') ? { checkServerIdentity: () => undefined } : undefined,
  });
}

function buildHostClient(password) {
  const host = getLegacyHost();
  if (!host) {
    return null;
  }

  return new Redis({
    host,
    port: getLegacyPort(),
    username: useIamAuth ? userId : undefined,
    password: password || undefined,
    tls: tlsEnabled ? { checkServerIdentity: () => undefined } : undefined,
    ...createRetryOptions(),
  });
}

let valkey = null;

async function createClient() {
  if (valkeyUrl) {
    valkey = buildUrlClient();
  } else {
    const password = useIamAuth ? await getIamToken() : undefined;
    valkey = buildHostClient(password);
  }

  if (!valkey) {
    return null;
  }

  valkey.on('error', (err) => {
    console.error('Valkey error:', err.message);
  });

  return valkey;
}

function getValkeyClient() {
  return valkey;
}

async function initValkey() {
  try {
    const client = await createClient();

    if (!client) {
      console.warn('Valkey is not configured. Auth service starts in degraded mode.');
      return false;
    }

    if (client.status === 'wait') {
      await client.connect();
    }

    await client.ping();
    console.log('Valkey connected');

    if (useIamAuth) {
      setInterval(async () => {
        try {
          const newToken = await getIamToken();
          client.options.password = newToken;
        } catch (err) {
          console.error('Failed to refresh Valkey IAM token:', err.message);
        }
      }, 10 * 60 * 1000).unref();
    }

    return true;
  } catch (err) {
    console.error('Valkey connection failed, continuing startup:', err.message);
    return false;
  }
}

async function checkValkey() {
  if (!valkey) {
    throw new Error('Valkey is not configured');
  }

  await valkey.ping();
  return true;
}

async function closeValkey() {
  if (valkey && valkey.status !== 'end') {
    await valkey.quit();
  }
}

module.exports = {
  getValkeyClient,
  initValkey,
  checkValkey,
  closeValkey,
};
