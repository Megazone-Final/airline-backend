const express = require('express');
const internal = require('../middleware/internal');
const {
  listReservationsByUser,
  findReservationByIdForUser,
  createReservation,
} = require('../repositories/reservations');

const router = express.Router();
const internalRouter = express.Router();

function validateReservationPayload(body) {
  if (!body.userId) {
    return '필수값이 누락되었습니다.';
  }

  if (!body.flightId) {
    return '필수값이 누락되었습니다.';
  }

  if (!body.date) {
    return '출발일이 누락되었습니다.';
  }

  if (!Array.isArray(body.passengers) || body.passengers.length === 0) {
    return '승객 정보가 누락되었습니다.';
  }

  for (const passenger of body.passengers) {
    if (
      !passenger.lastName ||
      !passenger.firstName ||
      !passenger.birth ||
      !passenger.passport
    ) {
      return '승객 정보가 올바르지 않습니다.';
    }
  }

  if (!Number.isFinite(Number(body.totalPrice)) || Number(body.totalPrice) <= 0) {
    return '결제 금액이 유효하지 않습니다.';
  }

  return null;
}

router.get('/', async (req, res) => {
  try {
    const reservations = await listReservationsByUser(1);
    res.json(reservations);
  } catch (err) {
    res.status(500).json({ message: '내부 오류가 발생했습니다.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const reservation = await findReservationByIdForUser(req.params.id, 1);
    if (!reservation) {
      return res.status(404).json({ message: '예약 정보를 찾을 수 없습니다.' });
    }

    return res.json(reservation);
  } catch (err) {
    return res.status(500).json({ message: '내부 오류가 발생했습니다.' });
  }
});

internalRouter.post('/reservations', internal, async (req, res) => {
  try {
    const validationMessage = validateReservationPayload(req.body);
    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const reservation = await createReservation({
      userId: Number(req.body.userId),
      paymentId: req.body.paymentId || null,
      flightId: Number(req.body.flightId),
      date: req.body.date,
      passengers: req.body.passengers,
      totalPrice: Number(req.body.totalPrice),
    });

    return res.status(201).json(reservation);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    return res.status(500).json({ message: '내부 오류가 발생했습니다.' });
  }
});

module.exports = {
  router,
  internalRouter,
};
