const express = require('express');
const { listFlights, findFlightById } = require('../repositories/flights');
const { createLogger } = require('../lib/logger');

const router = express.Router();
const logger = createLogger('flight');

router.get('/', async (req, res) => {
  try {
    const flights = await listFlights(req.query);
    res.json(flights);
  } catch (err) {
    logger.error('Flight list lookup failed', {
      event: 'flight_list_lookup_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl },
      error: err,
    });
    res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

router.get('/:id(\\d+)', async (req, res) => {
  try {
    const flight = await findFlightById(req.params.id);
    if (!flight) {
      logger.warn('Flight not found', {
        event: 'flight_not_found',
        category: 'user_input',
        reason: 'resource_not_found',
        statusCode: 404,
        context: { method: req.method, path: req.originalUrl, flightId: req.params.id },
      });
      return res.status(404).json({ message: '항공편을 찾을 수 없습니다' });
    }

    return res.json(flight);
  } catch (err) {
    logger.error('Flight detail lookup failed', {
      event: 'flight_detail_lookup_failed',
      category: 'application',
      reason: 'unhandled_exception',
      statusCode: 500,
      context: { method: req.method, path: req.originalUrl, flightId: req.params.id },
      error: err,
    });
    return res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

module.exports = router;
