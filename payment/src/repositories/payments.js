const crypto = require('crypto');
const { pool } = require('../lib/mysql');

function formatDate(value) {
  return value instanceof Date ? value.toISOString().split('T')[0] : value;
}

function buildPaymentId() {
  return `PAY-${Date.now().toString(36).toUpperCase()}${crypto
    .randomBytes(2)
    .toString('hex')
    .toUpperCase()}`;
}

function mapPayment(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    reservationId: row.reservationId,
    amount: row.amount,
    status: row.status,
    method: row.method,
    createdAt: row.createdAt,
  };
}

async function createPayment({
  userId,
  reservationId,
  flightId,
  amount,
  method,
  status,
  date,
  passengerCount,
}) {
  const paymentId = buildPaymentId();

  await pool.execute(
    `
      INSERT INTO payments (
        id,
        user_id,
        reservation_id,
        flight_id,
        amount,
        method,
        status,
        travel_date,
        passenger_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      paymentId,
      userId,
      reservationId,
      flightId,
      amount,
      method,
      status,
      date,
      passengerCount,
    ]
  );

  return findPaymentByIdForUser(paymentId, userId);
}

async function createPendingPayment({
  userId,
  flightId,
  amount,
  method,
  date,
  passengerCount,
}) {
  const paymentId = buildPaymentId();

  await pool.execute(
    `
      INSERT INTO payments (
        id,
        user_id,
        reservation_id,
        flight_id,
        amount,
        method,
        status,
        travel_date,
        passenger_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      paymentId,
      userId,
      null,
      flightId,
      amount,
      method,
      'pending',
      date,
      passengerCount,
    ]
  );

  return findPaymentByIdForUser(paymentId, userId);
}

async function completePayment(paymentId, userId, reservationId) {
  await pool.execute(
    `
      UPDATE payments
      SET reservation_id = ?, status = 'completed'
      WHERE id = ? AND user_id = ?
    `,
    [reservationId, paymentId, userId]
  );

  return findPaymentByIdForUser(paymentId, userId);
}

async function failPayment(paymentId, userId) {
  await pool.execute(
    `
      UPDATE payments
      SET status = 'failed'
      WHERE id = ? AND user_id = ?
    `,
    [paymentId, userId]
  );

  return findPaymentByIdForUser(paymentId, userId);
}

async function listPaymentsByUser(userId) {
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        reservation_id AS reservationId,
        amount,
        method,
        status,
        created_at AS createdAt
      FROM payments
      WHERE user_id = ?
      ORDER BY created_at DESC
    `,
    [userId]
  );

  return rows.map(mapPayment);
}

async function findPaymentByIdForUser(id, userId) {
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        reservation_id AS reservationId,
        amount,
        method,
        status,
        created_at AS createdAt,
        travel_date AS travelDate,
        passenger_count AS passengerCount,
        flight_id AS flightId
      FROM payments
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    [id, userId]
  );

  const payment = rows[0];
  if (!payment) {
    return null;
  }

  return {
    id: payment.id,
    reservationId: payment.reservationId,
    amount: payment.amount,
    status: payment.status,
    method: payment.method,
    createdAt: payment.createdAt,
    travelDate: formatDate(payment.travelDate),
    passengerCount: payment.passengerCount,
    flightId: payment.flightId,
  };
}

module.exports = {
  createPayment,
  createPendingPayment,
  completePayment,
  failPayment,
  listPaymentsByUser,
  findPaymentByIdForUser,
};
