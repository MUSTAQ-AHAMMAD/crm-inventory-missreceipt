/**
 * Activity logging middleware.
 * Records every authenticated API request to the ActivityLog table so that
 * admins can audit user behaviour.
 */

const prisma = require('../services/prisma');

/**
 * Logs the current request to ActivityLog after the response has been sent.
 * Only logs authenticated requests (req.user must be set by JWT middleware).
 * Skips high-frequency polling endpoints to avoid excessive DB writes.
 */
async function activityLogger(req, res, next) {
  // Let the route handler process the request first
  res.on('finish', async () => {
    if (!req.user) return; // skip unauthenticated requests

    // Skip logging for high-frequency polling endpoints (progress, detail)
    // to avoid DB contention during large uploads
    if (req.method === 'GET' && /\/uploads\/\d+\/(progress|detail|successes)/.test(req.originalUrl)) {
      return;
    }

    try {
      await prisma.activityLog.create({
        data: {
          userId: req.user.id,
          actionType: req.method,
          actionDetails: `${req.method} ${req.originalUrl} → ${res.statusCode}`,
          ipAddress: req.ip || req.connection?.remoteAddress,
        },
      });
    } catch (_err) {
      // Never let logging errors crash the application
    }
  });

  next();
}

module.exports = { activityLogger };
