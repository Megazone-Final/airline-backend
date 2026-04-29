const express = require('express');
const auth = require('../middleware/auth');
const {
  createPendingPayment,
  completePayment,
  failPayment,
  cancelPaymentForReservation,
  listPaymentsByUser,
  findPaymentByIdForUser,
  findPaymentByReservationIdForUser,
} = require('../repositories/payments');
const {
  getFlightDetail,
  createReservation,
  listReservations,
  cancelReservation,
} = require('../services/flights');
const { createLogger } = require('../lib/logger');

const router = express.Router();
const logger = createLogger('payment');

function validatePayment(body) {
  if (!body.flightId) {
    return '항공편 정보가 필요합니다';
  }

  if (!body.date) {
    return '출발일이 필요합니다';
  }

  if (!Array.isArray(body.passengers) || body.passengers.length === 0) {
    return '승객 정보가 필요합니다';
  }

  for (const passenger of body.passengers) {
    if (
      !passenger.lastName ||
      !passenger.firstName ||
      !passenger.birth ||
      !passenger.passport
    ) {
      return '유효한 승객 정보를 입력하세요';
    }
  }

  if (!Number.isFinite(Number(body.totalAmount)) || Number(body.totalAmount) <= 0) {
    return '유효하지 않은 결제 요청입니다';
  }

  return null;
}

router.post('/', auth, async (req, res) => {
  let pendingPayment = null;
  let createdReservation = null;

  try {
    const validationMessage = validatePayment(req.body);
    if (validationMessage) {
      logger.warn('Payment request validation failed', {
        event: 'validation_failed',
        category: 'user_input',
        reason: 'invalid_payment_payload',
        statusCode: 400,
        context: { method: req.method, path: req.originalUrl, userId: req.user?.id },
      });
      return res.status(400).json({ message: validationMessage });
    }

    const flight = await getFlightDetail(req.body.flightId);
    if (!flight) {
      logger.warn('Flight not found for payment request', {
        event: 'flight_not_found',
        category: 'user_input',
        reason: 'resource_not_found',
        statusCode: 404,
        context: {
          method: req.method,
          path: req.originalUrl,
          flightId: req.body.flightId,
          userId: req.user?.id,
        },
      });
      return res.status(404).json({ message: '항공편을 찾을 수 없습니다' });
    }

    pendingPayment = await createPendingPayment({
      userId: req.user.id,
      flightId: flight.id,
      amount: Number(req.body.totalAmount),
      method: 'CARD',
      date: req.body.date,
      passengerCount: req.body.passengers.length,
    });

    createdReservation = await createReservation({
      userId: req.user.id,
      paymentId: pendingPayment.id,
      flightId: Number(req.body.flightId),
      date: req.body.date,
      passengers: req.body.passengers,
      totalPrice: Number(req.body.totalAmount),
    });

    const payment = await completePayment(
      pendingPayment.id,
      req.user.id,
      createdReservation.id
    );

    return res.status(201).json(payment);
  } catch (err) {
    if (createdReservation?.id) {
      try {
        await cancelReservation(createdReservation.id, req.user.id);
      } catch (reservationCancelErr) {
        logger.error('Failed to cancel reservation after payment failure', {
          event: 'reservation_rollback_failed',
          category: 'data_integrity',
          reason: 'rollback_failed',
          statusCode: 500,
          context: { reservationId: createdReservation.id, userId: req.user?.id },
          error: reservationCancelErr,
        });
      }
    }

    if (pendingPayment?.id) {
      try {
        await failPayment(pendingPayment.id, req.user.id);
      } catch (paymentUpdateErr) {
        logger.error('Failed to update payment status after reservation failure', {
          event: 'payment_status_update_failed',
          category: 'data_integrity',
          reason: 'rollback_failed',
          statusCode: 500,
          context: { paymentId: pendingPayment.id, userId: req.user?.id },
          error: paymentUpdateErr,
        });
      }
    }

    if (err.statusCode) {
      logger.warn('Payment request rejected', {
        event: 'payment_request_rejected',
        category: 'external_dependency',
        reason: 'reservation_or_payment_rejected',
        statusCode: err.statusCode,
        context: { method: req.method, path: req.originalUrl, userId: req.user?.id },
        error: err,
      });
      return res.status(err.statusCode).json({ message: err.message });
    }

    logger.error('Payment creation failed unexpectedly', {
      event: 'payment_creation_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl, userId: req.user?.id },
      error: err,
    });
    return res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const payments = await listPaymentsByUser(req.user.id);
    return res.json(payments);
  } catch (err) {
    logger.error('Payment list lookup failed', {
      event: 'payment_list_lookup_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl, userId: req.user?.id },
      error: err,
    });
    return res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

router.get('/reservations', auth, async (req, res) => {
  try {
    const [reservations, payments] = await Promise.all([
      listReservations(req.user.id),
      listPaymentsByUser(req.user.id),
    ]);
    const paymentsByReservationId = new Map(
      payments
        .filter((payment) => (
          payment.reservationId && ['completed', 'cancelled'].includes(payment.status)
        ))
        .map((payment) => [payment.reservationId, payment])
    );
    const matchedReservations = reservations
      .filter((reservation) => paymentsByReservationId.has(reservation.id))
      .map((reservation) => ({
        ...reservation,
        payment: paymentsByReservationId.get(reservation.id),
      }));
    const matchedPayments = matchedReservations.map((reservation) => reservation.payment);

    return res.json({
      reservations: matchedReservations,
      payments: matchedPayments,
    });
  } catch (err) {
    if (err.statusCode) {
      logger.warn('Reservation history request rejected', {
        event: 'reservation_history_rejected',
        category: 'external_dependency',
        reason: 'reservation_history_lookup_failed',
        statusCode: err.statusCode,
        context: { method: req.method, path: req.originalUrl, userId: req.user?.id },
        error: err,
      });
      return res.status(err.statusCode).json({ message: err.message });
    }

    logger.error('Reservation history lookup failed unexpectedly', {
      event: 'reservation_history_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl, userId: req.user?.id },
      error: err,
    });
    return res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

router.patch('/reservations/:reservationId/cancel', auth, async (req, res) => {
  const { reservationId } = req.params;

  try {
    const reservation = await cancelReservation(reservationId, req.user.id);
    const payment = await findPaymentByReservationIdForUser(reservationId, req.user.id);
    const cancelledPayment = payment
      ? await cancelPaymentForReservation(reservationId, req.user.id)
      : null;

    return res.json({
      reservation,
      payment: cancelledPayment,
    });
  } catch (err) {
    if (err.statusCode) {
      logger.warn('Reservation cancellation request rejected', {
        event: 'reservation_cancel_rejected',
        category: 'external_dependency',
        reason: 'reservation_cancel_failed',
        statusCode: err.statusCode,
        context: { method: req.method, path: req.originalUrl, reservationId, userId: req.user?.id },
        error: err,
      });
      return res.status(err.statusCode).json({ message: err.message });
    }

    logger.error('Reservation cancellation failed unexpectedly', {
      event: 'reservation_cancel_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl, reservationId, userId: req.user?.id },
      error: err,
    });
    return res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const payment = await findPaymentByIdForUser(req.params.id, req.user.id);
    if (!payment) {
      logger.warn('Payment record not found', {
        event: 'payment_not_found',
        category: 'user_input',
        reason: 'resource_not_found',
        statusCode: 404,
        context: {
          method: req.method,
          path: req.originalUrl,
          paymentId: req.params.id,
          userId: req.user?.id,
        },
      });
      return res.status(404).json({ message: '결제 내역을 찾을 수 없습니다' });
    }

    return res.json(payment);
  } catch (err) {
    logger.error('Payment detail lookup failed', {
      event: 'payment_detail_lookup_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: {
        method: req.method,
        path: req.originalUrl,
        paymentId: req.params.id,
        userId: req.user?.id,
      },
      error: err,
    });
    return res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

module.exports = router;
