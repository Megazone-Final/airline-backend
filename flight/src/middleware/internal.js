module.exports = (req, res, next) => {
  const configuredKey = process.env.INTERNAL_API_KEY || '';

  if (!configuredKey) {
    return next();
  }

  if (req.headers['x-internal-api-key'] !== configuredKey) {
    return res.status(403).json({ message: '내부 요청만 허용됩니다' });
  }

  return next();
};
