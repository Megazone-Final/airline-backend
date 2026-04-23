require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const paymentsRoutes = require('./routes/payments');
const { initMySQL, checkMySQL, closeMySQL } = require('./lib/mysql');
const { initValkey, checkValkey, closeValkey } = require('./lib/valkey');
const { createLogger } = require('./lib/logger');
const { createMetrics } = require('./lib/metrics');

const app = express();
const PORT = process.env.PORT || 3000;
const logger = createLogger('payment');
const metrics = createMetrics('payment');
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
    exposedHeaders: ['X-Debug-Session-Token'],
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(metrics.middleware);
app.get('/metrics', metrics.handler);

app.use('/api/payment', paymentsRoutes);

app.get('/livez', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'payments',
  });
});

async function buildReadinessStatus() {
  const checks = await Promise.allSettled([checkMySQL(), checkValkey()]);
  const mysqlOk = checks[0].status === 'fulfilled' && checks[0].value === true;
  const valkeyOk = checks[1].status === 'fulfilled' && checks[1].value === true;
  const status = mysqlOk && valkeyOk ? 'ok' : 'degraded';

  return {
    statusCode: status === 'ok' ? 200 : 503,
    body: {
      status,
      service: 'payments',
      dependencies: {
        mysql: mysqlOk ? 'ok' : 'error',
        valkey: valkeyOk ? 'ok' : 'error',
      },
    },
  };
}

app.get('/readyz', async (req, res) => {
  const { statusCode, body } = await buildReadinessStatus();
  res.status(statusCode).json(body);
});

app.get('/health', async (req, res) => {
  const { statusCode, body } = await buildReadinessStatus();
  res.status(statusCode).json(body);
});

async function start() {
  await initMySQL();
  logger.info('MySQL connected', {
    event: 'mysql_connected',
    category: 'database',
  });

  await initValkey();

  app.listen(PORT, () => {
    logger.info('Payment service started', {
      event: 'service_started',
      context: { port: Number(PORT) },
    });
  });
}

async function shutdown(signal) {
  logger.info('Shutdown signal received', {
    event: 'shutdown_started',
    context: { signal },
  });
  await Promise.allSettled([closeMySQL(), closeValkey()]);
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

start().catch((err) => {
  logger.error('Payment service startup failed', {
    event: 'startup_failed',
    category: 'application',
    error: err,
  });
  process.exit(1);
});
