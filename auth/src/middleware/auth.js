const {
  getSession,
  touchSession,
  SESSION_COOKIE_NAME,
} = require('../services/sessions');
const { createLogger } = require('../lib/logger');

const logger = createLogger('auth');

function extractSessionToken(req) {
  if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
    return req.cookies[SESSION_COOKIE_NAME];
  }

  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.split(' ')[1];
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

    const refreshedSession = await touchSession(token, session);
    req.session = { token, ...refreshedSession };
    req.user = {
      id: refreshedSession.userId,
      email: refreshedSession.email,
      name: refreshedSession.name,
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
