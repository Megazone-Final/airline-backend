const { getValkeyClient } = require('../lib/valkey');

const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 7);
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'session_token';
const SESSION_PREFIX = process.env.SESSION_PREFIX || 'auth:session:';

function buildSessionKey(token) {
  return `${SESSION_PREFIX}${token}`;
}

async function getSession(token) {
  const valkey = getValkeyClient();
  if (!valkey) {
    throw new Error('Valkey is not configured');
  }

  const raw = await valkey.get(buildSessionKey(token));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    await valkey.del(buildSessionKey(token));
    return null;
  }
}

async function touchSession(token, session) {
  const valkey = getValkeyClient();
  if (!valkey) {
    throw new Error('Valkey is not configured');
  }

  const refreshedSession = {
    ...session,
    lastSeenAt: new Date().toISOString(),
  };

  await valkey.set(
    buildSessionKey(token),
    JSON.stringify(refreshedSession),
    'EX',
    SESSION_TTL_SECONDS
  );

  return refreshedSession;
}

module.exports = {
  getSession,
  touchSession,
  SESSION_COOKIE_NAME,
};
