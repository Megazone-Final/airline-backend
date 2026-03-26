require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const userRoutes = require('./routes/users');
const { initMySQL, checkMySQL, closeMySQL } = require('./lib/mysql');
const { initValkey, checkValkey, closeValkey } = require('./lib/valkey');
const { createLogger } = require('./lib/logger');

const app = express();
const PORT = process.env.PORT || 3001;
const logger = createLogger('auth');
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Middleware
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

// Routes
app.use('/api/auth/users', userRoutes);

app.get('/livez', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'auth',
  });
});

async function buildReadinessStatus() {
  const checks = await Promise.allSettled([checkMySQL(), checkValkey()]);
  const mysqlOk = checks[0].status === 'fulfilled';
  const valkeyOk = checks[1].status === 'fulfilled';
  const status = mysqlOk && valkeyOk ? 'ok' : 'degraded';

  return {
    statusCode: status === 'ok' ? 200 : 503,
    body: {
      status,
      service: 'auth',
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
    logger.info('Auth service started', {
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
  logger.error('Auth service startup failed', {
    event: 'startup_failed',
    category: 'application',
    error: err,
  });
  process.exit(1);
});
