const { createLogger } = require('../lib/logger');

const logger = createLogger('flight');
const AUTH_SERVICE_URL = (process.env.AUTH_SERVICE_URL || 'http://svc-auth.airline-auth.svc:3000').replace(
  /\/$/,
  ''
);
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'session_token';

function normalizeToken(value) {
  if (!value) {
    return null;
  }

  const token = String(value).trim();
  return token || null;
}

function extractSessionToken(req) {
  if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
    return normalizeToken(req.cookies[SESSION_COOKIE_NAME]);
  }

  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return normalizeToken(header.slice('Bearer '.length));
  }

  return null;
}

async function fetchProfile(token) {
  const response = await fetch(`${AUTH_SERVICE_URL}/api/auth/users/profile`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

module.exports = async (req, res, next) => {
  const token = extractSessionToken(req);
  if (!token) {
    logger.warn('Authentication token is missing', {
      event: 'authentication_failed',
      category: 'security',
      reason: 'missing_token',
      statusCode: 401,
      context: { method: req.method, path: req.originalUrl },
    });
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const profile = await fetchProfile(token);
    const userId = Number(profile?.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      logger.warn('Session validation failed', {
        event: 'authentication_failed',
        category: 'security',
        reason: 'invalid_session',
        statusCode: 401,
        context: { method: req.method, path: req.originalUrl },
      });
      return res.status(401).json({ message: 'Unauthorized' });
    }

    req.user = {
      id: userId,
      email: profile.email || null,
      name: profile.name || null,
    };
  } catch (err) {
    logger.warn('Authentication service is unavailable', {
      event: 'authentication_backend_unavailable',
      category: 'external_dependency',
      reason: 'profile_lookup_failed',
      statusCode: 503,
      context: { method: req.method, path: req.originalUrl },
      error: err,
    });
    return res.status(503).json({ message: '인증 서버를 사용할 수 없습니다' });
  }

  return next();
};
