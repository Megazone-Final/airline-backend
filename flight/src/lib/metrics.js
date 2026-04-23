const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function createMetrics(serviceName) {
  const requests = new Map();
  const durations = new Map();

  function labelKey(labels) {
    return JSON.stringify(labels);
  }

  function getRoute(req) {
    if (!req.route) {
      return 'unmatched';
    }

    const routePath = Array.isArray(req.route.path) ? req.route.path[0] : req.route.path;
    return `${req.baseUrl || ''}${routePath || ''}`.replace(/\/+/g, '/') || '/';
  }

  function getLabels(req, res) {
    return {
      service: serviceName,
      method: req.method,
      route: getRoute(req),
      status_code: String(res.statusCode),
    };
  }

  function observe(labels, seconds) {
    const key = labelKey(labels);
    requests.set(key, { labels, value: (requests.get(key)?.value || 0) + 1 });

    const metric = durations.get(key) || {
      labels,
      buckets: buckets.map(() => 0),
      count: 0,
      sum: 0,
    };

    buckets.forEach((bucket, index) => {
      if (seconds <= bucket) {
        metric.buckets[index] += 1;
      }
    });
    metric.count += 1;
    metric.sum += seconds;
    durations.set(key, metric);
  }

  function formatLabels(labels, extra = {}) {
    return Object.entries({ ...labels, ...extra })
      .map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',');
  }

  function middleware(req, res, next) {
    if (req.path === '/metrics') {
      return next();
    }

    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      observe(getLabels(req, res), elapsedSeconds);
    });

    return next();
  }

  function render() {
    const lines = [
      '# HELP http_requests_total Total HTTP requests.',
      '# TYPE http_requests_total counter',
    ];

    for (const { labels, value } of requests.values()) {
      lines.push(`http_requests_total{${formatLabels(labels)}} ${value}`);
    }

    lines.push(
      '# HELP http_request_duration_seconds HTTP request duration in seconds.',
      '# TYPE http_request_duration_seconds histogram'
    );

    for (const metric of durations.values()) {
      metric.buckets.forEach((value, index) => {
        lines.push(
          `http_request_duration_seconds_bucket{${formatLabels(metric.labels, {
            le: buckets[index],
          })}} ${value}`
        );
      });
      lines.push(
        `http_request_duration_seconds_bucket{${formatLabels(metric.labels, { le: '+Inf' })}} ${
          metric.count
        }`
      );
      lines.push(`http_request_duration_seconds_sum{${formatLabels(metric.labels)}} ${metric.sum}`);
      lines.push(`http_request_duration_seconds_count{${formatLabels(metric.labels)}} ${metric.count}`);
    }

    lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds{service="${serviceName}"} ${process.uptime()}`);

    return `${lines.join('\n')}\n`;
  }

  function handler(req, res) {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(render());
  }

  return {
    handler,
    middleware,
  };
}

module.exports = {
  createMetrics,
};
