const express = require('express');
const auth = require('../middleware/auth');
const internal = require('../middleware/internal');
const {
  listReservationsByUser,
  findReservationByIdForUser,
  createReservation,
  cancelReservationForUser,
} = require('../repositories/reservations');
const { createLogger } = require('../lib/logger');

const router = express.Router();
const internalRouter = express.Router();
const logger = createLogger('flight');

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

function parseUserId(value) {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

router.get('/', auth, async (req, res) => {
  try {
    const reservations = await listReservationsByUser(req.user.id);
    res.json(reservations);
  } catch (err) {
    logger.error('Reservation list lookup failed', {
      event: 'reservation_list_lookup_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl },
      error: err,
    });
    res.status(500).json({ message: '내부 오류가 발생했습니다.' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const reservation = await findReservationByIdForUser(req.params.id, req.user.id);
    if (!reservation) {
      logger.warn('Reservation not found', {
        event: 'reservation_not_found',
        category: 'user_input',
        reason: 'resource_not_found',
        statusCode: 404,
        context: { method: req.method, path: req.originalUrl, reservationId: req.params.id },
      });
      return res.status(404).json({ message: '예약 정보를 찾을 수 없습니다.' });
    }

    return res.json(reservation);
  } catch (err) {
    logger.error('Reservation detail lookup failed', {
      event: 'reservation_detail_lookup_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl, reservationId: req.params.id },
      error: err,
    });
    return res.status(500).json({ message: '내부 오류가 발생했습니다.' });
  }
});

router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const reservation = await cancelReservationForUser(req.params.id, req.user.id);
    if (!reservation) {
      logger.warn('Reservation not found for cancellation', {
        event: 'reservation_cancel_not_found',
        category: 'user_input',
        reason: 'resource_not_found',
        statusCode: 404,
        context: { method: req.method, path: req.originalUrl, reservationId: req.params.id, userId: req.user.id },
      });
      return res.status(404).json({ message: '예약 정보를 찾을 수 없습니다.' });
    }

    return res.json(reservation);
  } catch (err) {
    logger.error('Reservation cancellation failed', {
      event: 'reservation_cancel_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl, reservationId: req.params.id, userId: req.user?.id },
      error: err,
    });
    return res.status(500).json({ message: '내부 오류가 발생했습니다.' });
  }
});

internalRouter.post('/reservations', internal, async (req, res) => {
  try {
    const validationMessage = validateReservationPayload(req.body);
    if (validationMessage) {
      logger.warn('Reservation payload validation failed', {
        event: 'validation_failed',
        category: 'user_input',
        reason: 'invalid_reservation_payload',
        statusCode: 400,
        context: { method: req.method, path: req.originalUrl },
      });
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
      logger.warn('Reservation creation request rejected', {
        event: 'reservation_creation_rejected',
        category: 'user_input',
        reason: 'business_validation_failed',
        statusCode: err.statusCode,
        context: { method: req.method, path: req.originalUrl },
        error: err,
      });
      return res.status(err.statusCode).json({ message: err.message });
    }

    logger.error('Reservation creation failed unexpectedly', {
      event: 'reservation_creation_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl },
      error: err,
    });
    return res.status(500).json({ message: '내부 오류가 발생했습니다.' });
  }
});

internalRouter.get('/reservations', internal, async (req, res) => {
  try {
    const userId = parseUserId(req.query.userId);
    if (!userId) {
      logger.warn('Internal reservation list missing user id', {
        event: 'validation_failed',
        category: 'user_input',
        reason: 'missing_user_id',
        statusCode: 400,
        context: { method: req.method, path: req.originalUrl },
      });
      return res.status(400).json({ message: '사용자 정보가 필요합니다.' });
    }

    const reservations = await listReservationsByUser(userId);
    return res.json(reservations);
  } catch (err) {
    logger.error('Internal reservation list lookup failed', {
      event: 'internal_reservation_list_lookup_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl },
      error: err,
    });
    return res.status(500).json({ message: '내부 오류가 발생했습니다.' });
  }
});

internalRouter.patch('/reservations/:id/cancel', internal, async (req, res) => {
  try {
    const userId = parseUserId(req.body.userId);
    if (!userId) {
      logger.warn('Internal reservation cancellation missing user id', {
        event: 'validation_failed',
        category: 'user_input',
        reason: 'missing_user_id',
        statusCode: 400,
        context: { method: req.method, path: req.originalUrl, reservationId: req.params.id },
      });
      return res.status(400).json({ message: '사용자 정보가 필요합니다.' });
    }

    const reservation = await cancelReservationForUser(req.params.id, userId);
    if (!reservation) {
      return res.status(404).json({ message: '예약 정보를 찾을 수 없습니다.' });
    }

    return res.json(reservation);
  } catch (err) {
    logger.error('Internal reservation cancellation failed', {
      event: 'internal_reservation_cancel_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl, reservationId: req.params.id },
      error: err,
    });
    return res.status(500).json({ message: '내부 오류가 발생했습니다.' });
  }
});

module.exports = {
  router,
  internalRouter,
};
