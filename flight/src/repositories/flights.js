const { readerPool } = require('../lib/mysql');

function normalizeAirlineName(value) {
  return value && value !== 'SkyWing Air' ? value : 'MZC';
}

function normalizeFlightNo(value) {
  return value ? String(value).replace(/^SW/, 'MZC') : value;
}

function mapFlight(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    airline: normalizeAirlineName(row.airline),
    flightNo: normalizeFlightNo(row.flightNo),
    departure: row.departure,
    departureAirport: row.departureAirport,
    arrival: row.arrival,
    arrivalAirport: row.arrivalAirport,
    departureTime: row.departureTime,
    arrivalTime: row.arrivalTime,
    duration: row.duration,
    price: row.price,
    seats: row.seats,
    aircraft: row.aircraft,
  };
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

async function listFlights({ departure, arrival, passengers }) {
  const clauses = [];
  const params = [];

  if (departure) {
    clauses.push('departure = ?');
    params.push(normalizeCode(departure));
  }

  if (arrival) {
    clauses.push('arrival = ?');
    params.push(normalizeCode(arrival));
  }

  if (passengers) {
    clauses.push('seats >= ?');
    params.push(Number(passengers));
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await readerPool.execute(
    `
      SELECT
        id,
        airline,
        flight_no AS flightNo,
        departure,
        departure_airport AS departureAirport,
        arrival,
        arrival_airport AS arrivalAirport,
        departure_time AS departureTime,
        arrival_time AS arrivalTime,
        duration,
        price,
        seats,
        aircraft
      FROM flights
      ${whereClause}
      ORDER BY price ASC, departure_time ASC
    `,
    params
  );

  return rows.map(mapFlight);
}

async function findFlightById(id) {
  const [rows] = await readerPool.execute(
    `
      SELECT
        id,
        airline,
        flight_no AS flightNo,
        departure,
        departure_airport AS departureAirport,
        arrival,
        arrival_airport AS arrivalAirport,
        departure_time AS departureTime,
        arrival_time AS arrivalTime,
        duration,
        price,
        seats,
        aircraft
      FROM flights
      WHERE id = ?
      LIMIT 1
    `,
    [id]
  );

  return mapFlight(rows[0]);
}

module.exports = {
  listFlights,
  findFlightById,
};
