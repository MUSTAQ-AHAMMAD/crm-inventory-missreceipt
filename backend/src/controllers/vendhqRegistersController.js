/**
 * Controller for VendhqRegister CRUD operations.
 * Exposes list, create, update, and delete endpoints.
 */

const prisma = require('../services/prisma');

/**
 * GET /api/vendhq-registers
 * List all VendhqRegister records with optional pagination and search.
 */
async function listRegisters(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const search = req.query.search ? req.query.search.trim() : '';

    const where = search
      ? {
          OR: [
            { registerName: { contains: search, mode: 'insensitive' } },
            { registerId: { contains: search, mode: 'insensitive' } },
            { region: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [records, total] = await Promise.all([
      prisma.vendhqRegister.findMany({
        where,
        orderBy: { registerName: 'asc' },
        skip,
        take: limit,
      }),
      prisma.vendhqRegister.count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/vendhq-registers
 * Create a new VendhqRegister record.
 */
async function createRegister(req, res, next) {
  try {
    const {
      registerId,
      outletId,
      registerName,
      cashAccount,
      cashAccountId,
      bankAccount,
      bankAccountId,
      version,
      deletedAt,
      region,
      giftAccount,
      giftAccountId,
    } = req.body;

    if (!registerId || !registerName) {
      return res.status(400).json({ error: 'registerId and registerName are required.' });
    }

    const existing = await prisma.vendhqRegister.findUnique({ where: { registerId } });
    if (existing) {
      return res.status(409).json({ error: `Register with registerId "${registerId}" already exists.` });
    }

    const record = await prisma.vendhqRegister.create({
      data: {
        registerId,
        outletId: outletId || null,
        registerName,
        cashAccount: cashAccount || null,
        cashAccountId: cashAccountId || null,
        bankAccount: bankAccount || null,
        bankAccountId: bankAccountId || null,
        version: version || null,
        deletedAt: deletedAt || null,
        region: region || null,
        giftAccount: giftAccount || null,
        giftAccountId: giftAccountId || null,
      },
    });

    return res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/vendhq-registers/:id
 * Update an existing VendhqRegister record by primary key id.
 */
async function updateRegister(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });

    const {
      registerId,
      outletId,
      registerName,
      cashAccount,
      cashAccountId,
      bankAccount,
      bankAccountId,
      version,
      deletedAt,
      region,
      giftAccount,
      giftAccountId,
    } = req.body;

    if (!registerId || !registerName) {
      return res.status(400).json({ error: 'registerId and registerName are required.' });
    }

    // Check for duplicate registerId on a different record
    const dup = await prisma.vendhqRegister.findUnique({ where: { registerId } });
    if (dup && dup.id !== id) {
      return res.status(409).json({ error: `Register with registerId "${registerId}" already exists.` });
    }

    const record = await prisma.vendhqRegister.update({
      where: { id },
      data: {
        registerId,
        outletId: outletId || null,
        registerName,
        cashAccount: cashAccount || null,
        cashAccountId: cashAccountId || null,
        bankAccount: bankAccount || null,
        bankAccountId: bankAccountId || null,
        version: version || null,
        deletedAt: deletedAt || null,
        region: region || null,
        giftAccount: giftAccount || null,
        giftAccountId: giftAccountId || null,
      },
    });

    return res.json(record);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Register not found.' });
    }
    next(err);
  }
}

/**
 * DELETE /api/vendhq-registers/:id
 * Delete a VendhqRegister record by primary key id.
 */
async function deleteRegister(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id.' });

    await prisma.vendhqRegister.delete({ where: { id } });

    return res.json({ success: true });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Register not found.' });
    }
    next(err);
  }
}

module.exports = { listRegisters, createRegister, updateRegister, deleteRegister };
