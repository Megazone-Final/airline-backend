const { createLogger } = require('../lib/logger');

const logger = createLogger('flight');

module.exports = async (req, res, next) => {
  const userId = Number(req.headers['x-user-id']);
  if (!Number.isInteger(userId) || userId <= 0) {
    logger.warn('User identity header is invalid', {
      event: 'authentication_failed',
      category: 'security',
      reason: 'invalid_user_header',
      statusCode: 401,
      context: { method: req.method, path: req.originalUrl },
    });
    return res.status(401).json({ message: 'Unauthorized' });
  }

  req.user = {
    id: userId,
    email: req.headers['x-user-email'] || null,
    name: req.headers['x-user-name'] || null,
  };

  return next();
};
