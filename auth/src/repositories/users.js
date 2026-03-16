const bcrypt = require('bcryptjs');
const { pool } = require('../lib/mysql');

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    createdAt: row.createdAt,
  };
}

async function createUser({ name, email, password, phone }) {
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const [result] = await pool.execute(
      `
        INSERT INTO users (name, email, password_hash, phone)
        VALUES (?, ?, ?, ?)
      `,
      [String(name).trim(), normalizeEmail(email), passwordHash, String(phone).trim()]
    );

    return findUserById(result.insertId);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const duplicateError = new Error('이미 사용 중인 이메일입니다');
      duplicateError.statusCode = 409;
      throw duplicateError;
    }

    throw err;
  }
}

async function findUserByEmail(email) {
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        name,
        email,
        password_hash AS passwordHash,
        phone,
        created_at AS createdAt
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    [normalizeEmail(email)]
  );

  return rows[0] || null;
}

async function findUserById(id) {
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        name,
        email,
        phone,
        created_at AS createdAt
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [id]
  );

  return mapUser(rows[0]);
}

async function comparePassword(candidatePassword, passwordHash) {
  return bcrypt.compare(candidatePassword, passwordHash);
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  comparePassword,
};
