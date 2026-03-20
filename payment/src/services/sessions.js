const { getValkeyClient } = require('../lib/valkey');

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
    return null;
  }
}

module.exports = {
  getSession,
  SESSION_COOKIE_NAME,
};
