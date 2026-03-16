const crypto = require('crypto');
const { valkey } = require('../lib/valkey');

const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 7);
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'session_token';
const SESSION_PREFIX = process.env.SESSION_PREFIX || 'auth:session:';

function buildSessionKey(token) {
  return `${SESSION_PREFIX}${token}`;
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    userId: user.id,
    email: user.email,
    name: user.name,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };

  await valkey.set(buildSessionKey(token), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);

  return { token, session };
}

async function getSession(token) {
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

async function destroySession(token) {
  await valkey.del(buildSessionKey(token));
}

module.exports = {
  createSession,
  getSession,
  touchSession,
  destroySession,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
};
