const express = require('express');
const auth = require('../middleware/auth');
const {
  createUser,
  findUserByEmail,
  findUserById,
  comparePassword,
} = require('../repositories/users');
const {
  createSession,
  destroySession,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} = require('../services/sessions');

const router = express.Router();

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  };
}

function getSessionCookieClearOptions() {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    path: '/',
  };
}

function validateRegistration(body) {
  const { name, email, password, phone } = body;

  if (!name || !String(name).trim()) {
    return '이름을 입력하세요';
  }

  if (!email || !String(email).trim()) {
    return '이메일을 입력하세요';
  }

  if (!password) {
    return '비밀번호를 입력하세요';
  }

  if (String(password).length < 8) {
    return '비밀번호는 8자 이상이어야 합니다';
  }

  if (!phone || !String(phone).trim()) {
    return '전화번호를 입력하세요';
  }

  return null;
}


function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return String(phone).trim();
}

// POST /users/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const phone = normalizePhone(req.body.phone || '');
    const validationMessage = validateRegistration({ ...req.body, phone });

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const user = await createUser({ name, email, password, phone });
    res.status(201).json(user);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

// POST /users/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: '이메일과 비밀번호를 입력하세요' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다' });
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다' });
    }

    const { token } = await createSession(user);
    res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions());

    res.json({
      token,
      sessionToken: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

// POST /users/logout
router.post('/logout', auth, async (req, res) => {
  try {
    await destroySession(req.session.token);
    res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieClearOptions());
    res.json({ message: '로그아웃되었습니다' });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

// GET /users/profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: '사용자를 찾을 수 없습니다' });
    }
    res.json(user);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

module.exports = router;
