const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const flightsRoutes = require('./routes/flights');
const { router: reservationsRoutes, internalRouter } = require('./routes/reservations');
const { initMySQL, checkMySQL, closeMySQL } = require('./lib/mysql');
const { createLogger } = require('./lib/logger');

const app = express();
const PORT = process.env.PORT || 3002;
const logger = createLogger('flight');
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

app.use('/api/flight/reservations', reservationsRoutes);
app.use('/api/flight', flightsRoutes);
app.use('/internal', internalRouter);

app.get('/health', async (req, res) => {
  const mysqlOk = await checkMySQL()
    .then(() => true)
    .catch(() => false);
  const status = mysqlOk ? 'ok' : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    status,
    service: 'flights',
    dependencies: {
      mysql: mysqlOk ? 'ok' : 'error',
    },
  });
});

async function start() {
  await initMySQL();
  logger.info('MySQL connected', {
    event: 'mysql_connected',
    category: 'database',
  });

  app.listen(PORT, () => {
    logger.info('Flight service started', {
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
  await closeMySQL();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

start().catch((err) => {
  logger.error('Flight service startup failed', {
    event: 'startup_failed',
    category: 'application',
    error: err,
  });
  process.exit(1);
});
