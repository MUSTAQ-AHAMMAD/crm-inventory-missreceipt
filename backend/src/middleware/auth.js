/**
 * JWT authentication middleware.
 * Verifies the Bearer token on protected routes and attaches the decoded
 * user payload to req.user.
 */

const jwt = require('jsonwebtoken');

/**
 * Verifies the Authorization header JWT and populates req.user.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * Role-guard factory – restricts a route to users with one of the given roles.
 * Must be used AFTER `authenticate`.
 *
 * @param {...string} roles - Allowed roles (e.g. 'ADMIN', 'MANAGER')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    next();
  };
}

/**
 * Module-access guard – restricts a route to users granted the given module.
 * Must be used AFTER `authenticate`. Admins and users whose `modules` is unset
 * (null – legacy users) have access to every module.
 *
 * @param {string} moduleKey - module key from src/config/modules.js
 */
function requireModule(moduleKey) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.user.role === 'ADMIN') return next();
    const mods = req.user.modules;
    if (mods == null) return next(); // not set = full access (legacy users)
    if (Array.isArray(mods) && mods.includes(moduleKey)) return next();
    return res.status(403).json({ error: 'You do not have access to this module.' });
  };
}

module.exports = { authenticate, requireRole, requireModule };
