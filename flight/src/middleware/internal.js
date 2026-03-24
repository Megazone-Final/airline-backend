const { createLogger } = require('../lib/logger');

const logger = createLogger('flight');

module.exports = (req, res, next) => {
  const configuredKey = process.env.INTERNAL_API_KEY || '';

  if (!configuredKey) {
    return next();
  }

  if (req.headers['x-internal-api-key'] !== configuredKey) {
    logger.warn('Internal API key validation failed', {
      event: 'internal_authorization_failed',
      category: 'security',
      reason: 'invalid_internal_api_key',
      statusCode: 403,
      context: { method: req.method, path: req.originalUrl },
    });
    return res.status(403).json({ message: '내부 요청만 허용됩니다' });
  }

  return next();
};
