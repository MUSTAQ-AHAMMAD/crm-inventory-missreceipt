/**
 * Express application entry point.
 * Registers middleware, mounts API routes, and starts the HTTP server.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

// ─── BigInt JSON Serialization Fix ───────────────────────────────────────────
// Fix for BigInt values being serialized as "9n" instead of "9" in JSON payloads
// This affects FusionSalesMetadata.billToAccount and FusionInvoiceHeader.billToAccNumber
BigInt.prototype.toJSON = function() {
  return this.toString();
};

const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const inventoryTemplateRoutes = require('./routes/inventoryTemplate');
const miscReceiptRoutes = require('./routes/miscReceipt');
const standardReceiptRoutes = require('./routes/standardReceipt');
const applyReceiptRoutes = require('./routes/applyReceipt');
const arInvoiceRoutes = require('./routes/arInvoice');
const arInvoiceDataRoutes = require('./routes/arInvoiceData');
const vendInvoiceRoutes = require('./routes/vendInvoice');
const vendReceiptRoutes = require('./routes/vendReceipt');
const adminRoutes = require('./routes/admin');
const reportsRoutes = require('./routes/reports');
const arPipelineRoutes = require('./routes/arPipeline');
const vendhqRegistersRoutes = require('./routes/vendhqRegisters');
const batchSchedulerRoutes = require('./routes/batchScheduler');

const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Global Middleware ────────────────────────────────────────────────────────

// CORS – allow requests from the configured frontend origin
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);

// Parse JSON & URL-encoded bodies. Limit is configurable (MAX_REQUEST_BODY_SIZE)
// with a generous default so huge AR-invoice payloads (thousands of lines) aren't
// rejected with HTTP 413 before they ever reach the controller.
const REQUEST_BODY_LIMIT = process.env.MAX_REQUEST_BODY_SIZE || '250mb';
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT }));

// Request / response logging
app.use(requestLogger);

// Rate limiting – generous limit for authenticated API usage.
// The previous limit of 100/15min caused "Too many requests" errors during
// progress polling (every 1.5s = 600 requests per 15 min window).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

// Stricter rate limit on login endpoint to prevent brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});
app.use('/api/auth/login', authLimiter);

// ─── Swagger Docs ─────────────────────────────────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/inventory-template', inventoryTemplateRoutes);
app.use('/api/misc-receipt', miscReceiptRoutes);
app.use('/api/standard-receipt', standardReceiptRoutes);
app.use('/api/apply-receipt', applyReceiptRoutes);
app.use('/api/ar-invoice', arInvoiceRoutes);
app.use('/api/ar-invoice-data', arInvoiceDataRoutes);
app.use('/api/vend-invoice', vendInvoiceRoutes);
app.use('/api/vend-receipt', vendReceiptRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/ar-pipeline', arPipelineRoutes);
app.use('/api/vendhq-registers', vendhqRegistersRoutes);
app.use('/api/batch-scheduler', batchSchedulerRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`CRM Backend running on http://0.0.0.0:${PORT}`);
  console.log(`Swagger docs available at http://0.0.0.0:${PORT}/api/docs`);

  // Start cron-based batch scheduler (mirrors oracle-crm/src/scheduler.js start())
  // Loads all enabled SyncSchedule rows from DB and starts their cron tasks.
  const scheduler = require('./services/syncSchedulerService');
  scheduler.start().catch((err) =>
    console.warn(`[Scheduler] Failed to start schedules: ${err.message}`)
  );
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[ERROR] Port ${PORT} is already in use. Stop the other process or set PORT to an open port in backend/.env (and update VITE_API_BASE_URL in frontend/.env).`
    );
    process.exit(1);
  }

  console.error(`[ERROR] Failed to start server: ${err.message}`);
  process.exit(1);
});

module.exports = app;
