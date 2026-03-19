const express = require('express');
const { listFlights, findFlightById } = require('../repositories/flights');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const flights = await listFlights(req.query);
    res.json(flights);
  } catch (err) {
    res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

router.get('/:id(\\d+)', async (req, res) => {
  try {
    const flight = await findFlightById(req.params.id);
    if (!flight) {
      return res.status(404).json({ message: '항공편을 찾을 수 없습니다' });
    }

    return res.json(flight);
  } catch (err) {
    return res.status(500).json({ message: '서버 오류가 발생했습니다' });
  }
});

module.exports = router;
