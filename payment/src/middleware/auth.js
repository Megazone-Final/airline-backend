const {
  getSession,
  SESSION_COOKIE_NAME,
} = require('../services/sessions');
const { createLogger } = require('../lib/logger');

const DEBUG_TOKEN_HEADER = 'X-Debug-Session-Token';
const logger = createLogger('payment');

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

  const sessionHeader = req.headers['x-session-token'] || req.headers['x-access-token'];
  if (sessionHeader) {
    return normalizeToken(sessionHeader);
  }

  if (req.body && typeof req.body === 'object') {
    const bodyToken = req.body.sessionToken || req.body.token;
    if (bodyToken) {
      return normalizeToken(bodyToken);
    }
  }

  if (req.query && typeof req.query === 'object') {
    const queryToken = req.query.sessionToken || req.query.token;
    if (queryToken) {
      return normalizeToken(queryToken);
    }
  }

  return null;
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
    return res.status(401).json({ message: '인증이 필요합니다' });
  }

  if (process.env.NODE_ENV !== 'production') {
    res.setHeader(DEBUG_TOKEN_HEADER, token);
  }

  try {
    const session = await getSession(token);
    if (!session) {
      logger.warn('Session validation failed', {
        event: 'authentication_failed',
        category: 'security',
        reason: 'invalid_session',
        statusCode: 401,
        context: { method: req.method, path: req.originalUrl },
      });
      return res.status(401).json({ message: '유효하지 않은 세션입니다' });
    }

    req.session = { token, ...session };
    req.user = {
      id: session.userId,
      email: session.email,
      name: session.name,
    };

    next();
  } catch (err) {
    logger.warn('Authentication backend is unavailable', {
      event: 'authentication_backend_unavailable',
      category: 'external_dependency',
      reason: 'session_lookup_failed',
      statusCode: 503,
      context: { method: req.method, path: req.originalUrl },
      error: err,
    });
    return res.status(503).json({ message: '인증 서버를 사용할 수 없습니다' });
  }
};
