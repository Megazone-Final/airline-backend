const crypto = require('crypto');
const { pool } = require('../lib/mysql');

function formatDate(value) {
  return value instanceof Date ? value.toISOString().split('T')[0] : value;
}

function mapReservationSummary(row) {
  return {
    id: row.id,
    flightNo: row.flightNo,
    departure: row.departure,
    arrival: row.arrival,
    date: formatDate(row.date),
    departureTime: row.departureTime,
    status: row.status,
    passengerCount: row.passengerCount,
    totalPrice: row.totalPrice,
    createdAt: row.createdAt,
  };
}

function mapPassenger(row) {
  return {
    lastName: row.lastName,
    firstName: row.firstName,
    birth: formatDate(row.birth),
    gender: row.gender,
    passport: row.passport,
    nationality: row.nationality,
  };
}

function createReservationId() {
  return `SW-R${Date.now().toString(36).toUpperCase()}${crypto
    .randomBytes(2)
    .toString('hex')
    .toUpperCase()}`;
}

async function listReservationsByUser(userId) {
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        flight_no AS flightNo,
        departure,
        arrival,
        travel_date AS date,
        departure_time AS departureTime,
        status,
        passenger_count AS passengerCount,
        total_price AS totalPrice,
        created_at AS createdAt
      FROM reservations
      WHERE user_id = ?
      ORDER BY created_at DESC
    `,
    [userId]
  );

  return rows.map(mapReservationSummary);
}

async function findReservationByIdForUser(id, userId) {
  const [rows] = await pool.execute(
    `
      SELECT
        id,
        flight_no AS flightNo,
        departure,
        arrival,
        travel_date AS date,
        departure_time AS departureTime,
        arrival_time AS arrivalTime,
        status,
        total_price AS totalPrice,
        created_at AS createdAt
      FROM reservations
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    [id, userId]
  );

  const reservation = rows[0];
  if (!reservation) {
    return null;
  }

  const [passengerRows] = await pool.execute(
    `
      SELECT
        last_name AS lastName,
        first_name AS firstName,
        birth,
        gender,
        passport,
        nationality
      FROM reservation_passengers
      WHERE reservation_id = ?
      ORDER BY id ASC
    `,
    [id]
  );

  return {
    id: reservation.id,
    flightNo: reservation.flightNo,
    departure: reservation.departure,
    arrival: reservation.arrival,
    date: formatDate(reservation.date),
    departureTime: reservation.departureTime,
    arrivalTime: reservation.arrivalTime,
    status: reservation.status,
    passengers: passengerRows.map(mapPassenger),
    totalPrice: reservation.totalPrice,
    createdAt: reservation.createdAt,
  };
}

async function createReservation({
  userId,
  paymentId,
  flightId,
  date,
  passengers,
  totalPrice,
}) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [flightRows] = await connection.execute(
      `
        SELECT
          id,
          airline,
          flight_no AS flightNo,
          departure,
          arrival,
          departure_time AS departureTime,
          arrival_time AS arrivalTime,
          seats
        FROM flights
        WHERE id = ?
        FOR UPDATE
      `,
      [flightId]
    );

    const flight = flightRows[0];
    if (!flight) {
      const error = new Error('항공편을 찾을 수 없습니다');
      error.statusCode = 404;
      throw error;
    }

    if (flight.seats < passengers.length) {
      const error = new Error('잔여 좌석이 부족합니다');
      error.statusCode = 409;
      throw error;
    }

    const reservationId = createReservationId();

    await connection.execute(
      `
        INSERT INTO reservations (
          id,
          user_id,
          payment_id,
          flight_id,
          flight_no,
          airline,
          departure,
          arrival,
          departure_time,
          arrival_time,
          travel_date,
          status,
          passenger_count,
          total_price
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
      `,
      [
        reservationId,
        userId,
        paymentId || null,
        flight.id,
        flight.flightNo,
        flight.airline,
        flight.departure,
        flight.arrival,
        flight.departureTime,
        flight.arrivalTime,
        date,
        passengers.length,
        totalPrice,
      ]
    );

    for (const passenger of passengers) {
      await connection.execute(
        `
          INSERT INTO reservation_passengers (
            reservation_id,
            last_name,
            first_name,
            birth,
            gender,
            passport,
            nationality
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          reservationId,
          passenger.lastName,
          passenger.firstName,
          passenger.birth,
          passenger.gender,
          passenger.passport,
          passenger.nationality,
        ]
      );
    }

    await connection.execute('UPDATE flights SET seats = seats - ? WHERE id = ?', [
      passengers.length,
      flight.id,
    ]);

    await connection.commit();

    return {
      id: reservationId,
      flightNo: flight.flightNo,
      departure: flight.departure,
      arrival: flight.arrival,
      date,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      status: 'confirmed',
      passengers,
      totalPrice,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  listReservationsByUser,
  findReservationByIdForUser,
  createReservation,
};
