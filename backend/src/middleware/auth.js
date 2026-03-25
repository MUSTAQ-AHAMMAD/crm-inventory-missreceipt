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

module.exports = { authenticate, requireRole };
