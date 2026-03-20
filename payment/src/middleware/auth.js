const {
  getSession,
  SESSION_COOKIE_NAME,
} = require('../services/sessions');

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
    return res.status(401).json({ message: '인증이 필요합니다' });
  }

  try {
    const session = await getSession(token);
    if (!session) {
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
    return res.status(503).json({ message: '인증 서버를 사용할 수 없습니다' });
  }
};
