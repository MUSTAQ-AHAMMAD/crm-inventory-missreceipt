/**
 * VendhqRegister CRUD routes.
 * All routes require authentication.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { activityLogger } = require('../middleware/activityLogger');
const {
  listRegisters,
  createRegister,
  updateRegister,
  deleteRegister,
} = require('../controllers/vendhqRegistersController');

const router = express.Router();

router.use(authenticate, activityLogger);

/**
 * GET /api/vendhq-registers
 * List all VendhqRegister records (paginated, optional search).
 */
router.get('/', listRegisters);

/**
 * POST /api/vendhq-registers
 * Create a new VendhqRegister record.
 */
router.post('/', createRegister);

/**
 * PUT /api/vendhq-registers/:id
 * Update an existing VendhqRegister record.
 */
router.put('/:id', updateRegister);

/**
 * DELETE /api/vendhq-registers/:id
 * Delete a VendhqRegister record.
 */
router.delete('/:id', deleteRegister);

module.exports = router;
