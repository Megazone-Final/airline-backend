require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const paymentsRoutes = require('./routes/payments');
const { initMySQL, checkMySQL, closeMySQL } = require('./lib/mysql');
const { initValkey, checkValkey, closeValkey } = require('./lib/valkey');

const app = express();
const PORT = process.env.PORT || 3000;
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

app.use('/api/payment', paymentsRoutes);
app.use('/api/payments', paymentsRoutes);

app.get('/health', async (req, res) => {
  const checks = await Promise.allSettled([checkMySQL(), checkValkey()]);
  const mysqlOk = checks[0].status === 'fulfilled' && checks[0].value === true;
  const valkeyOk = checks[1].status === 'fulfilled' && checks[1].value === true;
  const status = mysqlOk && valkeyOk ? 'ok' : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    status,
    service: 'payments',
    dependencies: {
      mysql: mysqlOk ? 'ok' : 'error',
      valkey: valkeyOk ? 'ok' : 'error',
    },
  });
});

async function start() {
  await initMySQL();
  console.log('MySQL connected');

  const valkeyReady = await initValkey();
  if (valkeyReady) {
    console.log('Valkey connected');
  } else {
    console.warn('Valkey unavailable, service started in degraded mode');
  }

  app.listen(PORT, () => {
    console.log(`Payment service running on port ${PORT}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
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
  console.error('Startup error:', err.stack || err.message || err);
  process.exit(1);
});
