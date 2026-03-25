/**
 * Authentication controller.
 * Handles login, logout and /me endpoints.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../services/prisma');

/**
 * POST /api/auth/login
 * Validates email/password credentials and returns a signed JWT token.
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({ error: 'Account is disabled. Contact your administrator.' });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        actionType: 'LOGIN',
        actionDetails: `User ${user.email} logged in`,
        ipAddress: req.ip,
      },
    });

    return res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/logout
 * Client-side logout – the JWT is stateless so we just log the action.
 */
async function logout(req, res, next) {
  try {
    if (req.user) {
      await prisma.activityLog.create({
        data: {
          userId: req.user.id,
          actionType: 'LOGOUT',
          actionDetails: `User ${req.user.email} logged out`,
          ipAddress: req.ip,
        },
      });
    }
    return res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me
 * Returns the current authenticated user's profile.
 */
async function me(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, role: true, isActive: true, createdAt: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.json(user);
  } catch (err) {
    next(err);
  }
}

module.exports = { login, logout, me };
