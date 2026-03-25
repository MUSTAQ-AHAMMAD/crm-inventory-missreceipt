/**
 * Admin / User Management routes.
 * All routes require ADMIN role.
 *
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin-only user management endpoints
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  createUser,
  listUsers,
  updateUser,
  deleteUser,
  resetPassword,
} = require('../controllers/adminController');

const router = express.Router();

// All admin routes require authentication + ADMIN role
router.use(authenticate, requireRole('ADMIN'), activityLogger);

/**
 * @swagger
 * /admin/users:
 *   post:
 *     tags: [Admin]
 *     summary: Create a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [ADMIN, MANAGER, USER]
 *     responses:
 *       201:
 *         description: Created user
 */
router.post('/users', createUser);

/**
 * @swagger
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: List all users (paginated)
 *     responses:
 *       200:
 *         description: Paginated list of users
 */
router.get('/users', listUsers);

/**
 * @swagger
 * /admin/users/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Update a user's email, role, or active status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               role:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated user
 */
router.put('/users/:id', updateUser);

/**
 * @swagger
 * /admin/users/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Soft-delete a user (set isActive = false)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User disabled
 */
router.delete('/users/:id', deleteUser);

/**
 * @swagger
 * /admin/users/{id}/reset-password:
 *   post:
 *     tags: [Admin]
 *     summary: Reset a user's password and return the new password
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: New password (one-time display)
 */
router.post('/users/:id/reset-password', resetPassword);

module.exports = router;
