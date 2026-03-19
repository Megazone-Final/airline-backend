const Redis = require('ioredis');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function parseBoolean(value) {
  if (value == null) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const host = requiredEnv('VALKEY_HOST');
const port = parseInt(process.env.VALKEY_PORT || '6379');
const useIamAuth = parseBoolean(process.env.VALKEY_USE_IAM_AUTH) ?? false;
const tlsEnabled = parseBoolean(process.env.VALKEY_TLS) ?? false;
const userId = process.env.VALKEY_USER; // IAM 인증 시 ElastiCache User ID
const clusterName = process.env.VALKEY_CLUSTER_NAME; // ElastiCache Replication Group ID
const region = process.env.AWS_REGION || 'ap-northeast-2';

async function getIamToken() {
  const { SignatureV4 } = require('@aws-sdk/signature-v4');
  const { Hash } = require('@smithy/hash-node');
  const { defaultProvider } = require('@aws-sdk/credential-provider-node');

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: 'elasticache',
    sha256: Hash.bind(null, 'sha256'),
  });

  const url = new URL(`https://${clusterName}/?Action=connect&User=${userId}`);
  const request = {
    method: 'GET',
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers: { host: url.hostname },
  };

  const signed = await signer.presign(request, { expiresIn: 900 });
  const queryString = Object.entries(signed.query || {})
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  return `${url.pathname}?${queryString}`;
}

function buildOptions(password) {
  return {
    host,
    port,
    username: useIamAuth ? userId : undefined,
    password: password || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
    tls: tlsEnabled ? { checkServerIdentity: () => undefined } : undefined,
  };
}

let valkey;

async function createClient() {
  const password = useIamAuth ? await getIamToken() : undefined;
  valkey = new Redis(buildOptions(password));

  valkey.on('error', (err) => {
    console.error('Valkey error:', err.message);
  });

  return valkey;
}

async function initValkey() {
  try {
    await createClient();
    if (valkey.status === 'wait') {
      await valkey.connect();
    }
    await valkey.ping();
    console.log('Valkey connected');

    // IAM 토큰은 15분 만료 → 10분마다 재발급
    if (useIamAuth) {
      setInterval(async () => {
        try {
          const newToken = await getIamToken();
          valkey.options.password = newToken;
        } catch (err) {
          console.error('Failed to refresh Valkey IAM token:', err.message);
        }
      }, 10 * 60 * 1000).unref();
    }
  } catch (err) {
    console.error('Valkey connection failed, continuing startup:', err.message);
  }
}

async function checkValkey() {
  try {
    await valkey.ping();
    return true;
  } catch {
    return false;
  }
}

async function closeValkey() {
  if (valkey && valkey.status !== 'end') {
    await valkey.quit();
  }
}

module.exports = {
  get valkey() {
    return valkey;
  },
  initValkey,
  checkValkey,
  closeValkey,
};
