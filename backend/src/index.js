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

const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const miscReceiptRoutes = require('./routes/miscReceipt');
const adminRoutes = require('./routes/admin');
const reportsRoutes = require('./routes/reports');

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

// Parse JSON & URL-encoded bodies (50 MB limit for large CSV uploads)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
app.use('/api/misc-receipt', miscReceiptRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`CRM Backend running on http://localhost:${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/api/docs`);
});

module.exports = app;
