module.exports = async (req, res, next) => {
  const userId = Number(req.headers['x-user-id']);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  req.user = {
    id: userId,
    email: req.headers['x-user-email'] || null,
    name: req.headers['x-user-name'] || null,
  };

  return next();
};
