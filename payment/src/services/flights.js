const FLIGHTS_SERVICE_URL = (process.env.FLIGHTS_SERVICE_URL || 'http://svc-flight.airline-flight.svc:3000').replace(
  /\/$/,
  ''
);

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return { data: null, text: '' };
  }

  try {
    return { data: JSON.parse(text), text };
  } catch (err) {
    return { data: null, text };
  }
}

function buildErrorMessage(body, text) {
  if (body && typeof body === 'object' && body.message) {
    return body.message;
  }

  if (text) {
    return text.slice(0, 300);
  }

  return 'Flight service request failed';
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

  const { data: body, text } = await parseResponseBody(response);
  if (!response.ok) {
    const error = new Error(buildErrorMessage(body, text));
    error.statusCode = response.status;
    error.responseBody = body ?? text;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  if (body === null) {
    const error = new Error('Flight service returned a non-JSON response');
    error.statusCode = 502;
    error.responseBody = text;
    throw error;
  }

  return body;
}

async function getFlightDetail(flightId) {
  return request(`/api/flight/${flightId}`);
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

async function listReservations(userId) {
  const headers = {};

  if (process.env.INTERNAL_API_KEY) {
    headers['x-internal-api-key'] = process.env.INTERNAL_API_KEY;
  }

  return request(`/internal/reservations?userId=${encodeURIComponent(userId)}`, {
    headers,
  });
}

async function cancelReservation(reservationId, userId) {
  const headers = {};

  if (process.env.INTERNAL_API_KEY) {
    headers['x-internal-api-key'] = process.env.INTERNAL_API_KEY;
  }

  return request(`/internal/reservations/${encodeURIComponent(reservationId)}/cancel`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ userId }),
  });
}

module.exports = {
  getFlightDetail,
  createReservation,
  listReservations,
  cancelReservation,
};
