const DEFAULT_FLIGHTS_SERVICE_URLS = [
  'http://svc-flight.flight.svc',
  'http://svc-flight.flight.svc:80',
  'http://svc-flight.flight.svc:3002',
  'http://svc-flight.airline-flight.svc:3000',
];

function getFlightsServiceUrls() {
  const configuredUrls = (process.env.FLIGHTS_SERVICE_URL || '')
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const urls = configuredUrls.length > 0 ? configuredUrls : DEFAULT_FLIGHTS_SERVICE_URLS;
  return [...new Set(urls)];
}

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
  const urls = getFlightsServiceUrls();
  let lastError = null;

  for (const baseUrl of urls) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
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
        error.baseUrl = baseUrl;
        lastError = error;

        if (response.status === 404 && baseUrl !== urls[urls.length - 1]) {
          continue;
        }

        throw error;
      }

      if (response.status === 204) {
        return null;
      }

      if (body === null) {
        const error = new Error('Flight service returned a non-JSON response');
        error.statusCode = 502;
        error.responseBody = text;
        error.baseUrl = baseUrl;
        throw error;
      }

      return body;
    } catch (err) {
      lastError = err;

      if (err.statusCode && err.statusCode !== 404) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Flight service request failed');
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
