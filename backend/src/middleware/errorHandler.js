/**
 * Global error-handling middleware.
 * Catches errors thrown (or passed via next(err)) from route handlers and
 * returns a consistent JSON error response.
 */

function errorHandler(err, req, res, _next) {
  console.error('[Error]', err.message || err);

  // Zod validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    });
  }

  // Prisma unique-constraint violation
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: `A record with this ${err.meta?.target?.join(', ')} already exists.`,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
