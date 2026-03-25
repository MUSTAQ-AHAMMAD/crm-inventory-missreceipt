/**
 * Activity logging middleware.
 * Records every authenticated API request to the ActivityLog table so that
 * admins can audit user behaviour.
 */

const prisma = require('../services/prisma');

/**
 * Logs the current request to ActivityLog after the response has been sent.
 * Only logs authenticated requests (req.user must be set by JWT middleware).
 */
async function activityLogger(req, res, next) {
  // Let the route handler process the request first
  res.on('finish', async () => {
    if (!req.user) return; // skip unauthenticated requests

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
