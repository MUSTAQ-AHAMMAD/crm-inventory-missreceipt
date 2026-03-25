/**
 * Admin / User Management controller.
 * All routes in this controller are restricted to ADMIN users.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../services/prisma');

/**
 * POST /api/admin/users
 * Creates a new user with a hashed password.
 */
async function createUser(req, res, next) {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const validRoles = ['ADMIN', 'MANAGER', 'USER'];
    const userRole = role && validRoles.includes(role) ? role : 'USER';

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, passwordHash, role: userRole },
      select: { id: true, email: true, role: true, isActive: true, createdAt: true },
    });

    return res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/users
 * Returns a paginated list of all users.
 */
async function listUsers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, role: true, isActive: true, createdAt: true, updatedAt: true },
      }),
      prisma.user.count(),
    ]);

    return res.json({ users, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/admin/users/:id
 * Updates a user's email, role, or isActive status.
 */
async function updateUser(req, res, next) {
  try {
    const userId = parseInt(req.params.id);
    const { email, role, isActive } = req.body;

    const validRoles = ['ADMIN', 'MANAGER', 'USER'];
    const data = {};
    if (email) data.email = email;
    if (role && validRoles.includes(role)) data.role = role;
    if (typeof isActive === 'boolean') data.isActive = isActive;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update.' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, role: true, isActive: true, updatedAt: true },
    });

    return res.json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/admin/users/:id
 * Soft-deletes a user by setting isActive = false.
 * Prevents deletion of the last admin account.
 */
async function deleteUser(req, res, next) {
  try {
    const userId = parseInt(req.params.id);

    // Prevent admin from disabling themselves
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot disable your own account.' });
    }

    // Ensure at least one admin remains
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (targetUser.role === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true },
      });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot disable the last active admin.' });
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    return res.json({ message: 'User disabled successfully.' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/users/:id/reset-password
 * Generates a new random password and returns it (plaintext, one-time only).
 */
async function resetPassword(req, res, next) {
  try {
    const userId = parseInt(req.params.id);

    // Generate a secure random password
    const newPassword = crypto.randomBytes(8).toString('hex'); // 16-char hex
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return res.json({
      message: 'Password reset successfully.',
      newPassword, // Return once – instruct user to change on next login
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createUser, listUsers, updateUser, deleteUser, resetPassword };
