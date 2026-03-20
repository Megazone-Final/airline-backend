const express = require('express');
const auth = require('../middleware/auth');
const {
  createPendingPayment,
  completePayment,
  failPayment,
  listPaymentsByUser,
  findPaymentByIdForUser,
} = require('../repositories/payments');
const {
  getFlightDetail,
  createReservation,
} = require('../services/flights');

const router = express.Router();

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

  try {
    const validationMessage = validatePayment(req.body);
    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const flight = await getFlightDetail(req.body.flightId);
    if (!flight) {
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

    const reservation = await createReservation({
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
      reservation.id
    );

    return res.status(201).json(payment);
  } catch (err) {
    if (pendingPayment?.id) {
      try {
        await failPayment(pendingPayment.id, req.user.id);
      } catch (paymentUpdateErr) {
        console.error(
          'Payment failure status update failed:',
          paymentUpdateErr.stack || paymentUpdateErr.message || paymentUpdateErr
        );
      }
    }

    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    return res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const payments = await listPaymentsByUser(req.user.id);
    return res.json(payments);
  } catch (err) {
    return res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const payment = await findPaymentByIdForUser(req.params.id, req.user.id);
    if (!payment) {
      return res.status(404).json({ message: '결제 내역을 찾을 수 없습니다' });
    }

    return res.json(payment);
  } catch (err) {
    return res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

module.exports = router;
