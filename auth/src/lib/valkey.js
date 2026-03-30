const Redis = require('ioredis');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { SignatureV4 } = require('@smithy/signature-v4');
const { Hash } = require('@smithy/hash-node');
const { createLogger } = require('./logger');

function parseBoolean(value) {
  if (value == null) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const logger = createLogger('auth');
const region = process.env.AWS_REGION || 'ap-northeast-2';
const awsCredentialTimeoutMs = Number(process.env.AWS_CREDENTIALS_TIMEOUT_MS || 5000);
const awsCredentialRetries = Number(process.env.AWS_CREDENTIALS_MAX_RETRIES || 2);
const awsCredentials = defaultProvider({
  timeout: awsCredentialTimeoutMs,
  maxRetries: awsCredentialRetries,
});
const secretsManager = new SecretsManagerClient({
  region,
  credentials: awsCredentials,
});

let valkey = null;
let resolvedConnection = null;
let cachedSecretEndpoint;
let secretEndpointLoaded = false;

function getValkeyUser() {
  return process.env.VALKEY_USER;
}

function getValkeyEndpointSecretId() {
  return (
    process.env.VALKEY_ENDPOINT_SECRET_ID ||
    process.env.VALKEY_ENDPOINT_SECRET_ARN ||
    process.env.VALKEY_SECRET_ID ||
    process.env.VALKEY_SECRET_ARN
  );
}

function looksLikeEndpointValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith('redis://') || normalized.startsWith('rediss://')) {
    return true;
  }

  return normalized.includes('.cache.amazonaws.com');
}

function getExplicitEndpoint() {
  return process.env.VALKEY_ENDPOINT || process.env.VALKEY_URL;
}

function getLegacyHost() {
  return process.env.VALKEY_HOST;
}

function getLegacyPort() {
  return parseInt(process.env.VALKEY_PORT || '6379', 10);
}

function useIamAuth() {
  return parseBoolean(process.env.VALKEY_USE_IAM_AUTH) ?? false;
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

function tryParseSecretJson(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function normalizeEndpointValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return null;
  }

  const parsed = value.startsWith('{') ? tryParseSecretJson(value) : null;
  if (!parsed) {
    return value;
  }

  const directValue =
    parsed.endpoint ||
    parsed.url ||
    parsed.value ||
    parsed.VALKEY_ENDPOINT ||
    parsed.VALKEY_URL;
  if (typeof directValue === 'string' && directValue.trim()) {
    return directValue.trim();
  }

  const host = parsed.host || parsed.address || parsed.hostname || parsed.VALKEY_HOST;
  const port = parsed.port || parsed.VALKEY_PORT || 6379;
  if (typeof host === 'string' && host.trim()) {
    return `${host.trim()}:${port}`;
  }

  return null;
}

function parseEndpoint(endpointValue) {
  if (!endpointValue) {
    return null;
  }

  const normalized = String(endpointValue).trim();
  const url =
    normalized.includes('://') ? new URL(normalized) : new URL(`rediss://${normalized}`);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    tlsFromEndpoint: url.protocol === 'rediss:',
  };
}

function resolveTlsEnabled(connection) {
  const configured = parseBoolean(process.env.VALKEY_TLS);
  if (configured !== undefined) {
    return configured;
  }

  return connection.tlsFromEndpoint || useIamAuth();
}

function resolveCacheName(host) {
  const explicit = process.env.VALKEY_CACHE_NAME || process.env.VALKEY_CLUSTER_NAME;
  if (explicit) {
    return explicit.trim().toLowerCase();
  }

  const segments = String(host || '')
    .trim()
    .toLowerCase()
    .split('.')
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  if ((segments[0] === 'master' || segments[0] === 'replica') && segments.length > 1) {
    return segments[1];
  }

  return segments[0];
}

async function fetchEndpointFromSecret() {
  if (secretEndpointLoaded) {
    return cachedSecretEndpoint;
  }

  secretEndpointLoaded = true;
  const secretId = getValkeyEndpointSecretId();
  if (!secretId) {
    cachedSecretEndpoint = null;
    return cachedSecretEndpoint;
  }

  if (looksLikeEndpointValue(secretId)) {
    cachedSecretEndpoint = normalizeEndpointValue(secretId);
    return cachedSecretEndpoint;
  }

  const response = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretId }));
  const secretString = response.SecretString
    || (response.SecretBinary ? Buffer.from(response.SecretBinary, 'base64').toString('utf8') : '');

  cachedSecretEndpoint = normalizeEndpointValue(secretString);
  return cachedSecretEndpoint;
}

async function resolveConnectionConfig() {
  if (resolvedConnection) {
    return resolvedConnection;
  }

  const endpointValue = (await fetchEndpointFromSecret()) || getExplicitEndpoint();
  const parsedEndpoint = parseEndpoint(endpointValue);
  if (parsedEndpoint) {
    resolvedConnection = {
      host: parsedEndpoint.host,
      port: parsedEndpoint.port,
      tls: resolveTlsEnabled(parsedEndpoint),
      cacheName: resolveCacheName(parsedEndpoint.host),
    };
    return resolvedConnection;
  }

  const host = getLegacyHost();
  if (!host) {
    return null;
  }

  resolvedConnection = {
    host,
    port: getLegacyPort(),
    tls: resolveTlsEnabled({ tlsFromEndpoint: false }),
    cacheName: resolveCacheName(host),
  };

  return resolvedConnection;
}

async function getIamToken(connection) {
  const userId = getValkeyUser();
  if (!userId) {
    throw new Error('VALKEY IAM auth requires VALKEY_USER');
  }

  if (!connection?.cacheName) {
    throw new Error(
      'VALKEY IAM auth requires a cache name. Set VALKEY_CACHE_NAME or provide a parsable endpoint.'
    );
  }

  const signer = new SignatureV4({
    credentials: awsCredentials,
    region,
    service: 'elasticache',
    sha256: Hash.bind(null, 'sha256'),
  });

  const signed = await signer.presign(
    {
      method: 'GET',
      protocol: 'http:',
      hostname: connection.cacheName,
      path: '/',
      query: {
        Action: 'connect',
        User: userId,
      },
      headers: { host: connection.cacheName },
    },
    { expiresIn: 900 }
  );

  const qs = Object.entries(signed.query || {})
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  return `${signed.hostname}${signed.path}?${qs}`;
}

function createRedisClient(connection, password) {
  const client = new Redis({
    host: connection.host,
    port: connection.port,
    username: useIamAuth() ? getValkeyUser() : undefined,
    password: password || undefined,
    tls: connection.tls ? { checkServerIdentity: () => undefined } : undefined,
    ...createRetryOptions(),
  });

  client.on('error', (err) => {
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

async function createClient() {
  const connection = await resolveConnectionConfig();
  if (!connection) {
    return null;
  }

  const password = useIamAuth() ? await getIamToken(connection) : undefined;
  valkey = createRedisClient(connection, password);
  return valkey;
}

function getValkeyClient() {
  return valkey;
}

async function initValkey() {
  try {
    const client = await createClient();

    if (!client) {
      logger.warn('Valkey is not configured, auth service started in degraded mode', {
        event: 'valkey_unavailable',
        category: 'configuration',
        reason: 'missing_configuration',
        context: { dependency: 'valkey' },
      });
      return false;
    }

    if (client.status === 'wait') {
      await client.connect();
    }

    await client.ping();
    logger.info('Valkey connected', {
      event: 'valkey_connected',
      category: 'external_dependency',
      context: { dependency: 'valkey' },
    });

    if (useIamAuth()) {
      setInterval(async () => {
        try {
          const connection = await resolveConnectionConfig();
          const newToken = await getIamToken(connection);
          client.options.password = newToken;
        } catch (err) {
          logger.warn('Failed to refresh Valkey IAM token', {
            event: 'valkey_iam_token_refresh_failed',
            category: 'external_dependency',
            reason: 'token_refresh_failed',
            context: { dependency: 'valkey' },
            error: err,
          });
        }
      }, 10 * 60 * 1000).unref();
    }

    return true;
  } catch (err) {
    logger.warn('Valkey connection failed, auth service continues in degraded mode', {
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
