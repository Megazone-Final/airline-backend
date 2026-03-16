const FLIGHTS_SERVICE_URL = (process.env.FLIGHTS_SERVICE_URL || 'http://localhost:3002').replace(
  /\/$/,
  ''
);

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function request(path, options = {}) {
  const response = await fetch(`${FLIGHTS_SERVICE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(5000),
  });

  const body = await parseJson(response);
  if (!response.ok) {
    const error = new Error(body?.message || 'Flight service request failed');
    error.statusCode = response.status;
    throw error;
  }

  return body;
}

async function getFlightDetail(flightId) {
  return request(`/flights/${flightId}`);
}

async function createReservation(payload) {
  const headers = {};

  if (process.env.INTERNAL_API_KEY) {
    headers['x-internal-api-key'] = process.env.INTERNAL_API_KEY;
  }

  return request('/internal/reservations', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

module.exports = {
  getFlightDetail,
  createReservation,
};
