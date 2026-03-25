/**
 * Prisma client singleton.
 * Reuses a single PrismaClient instance across the application to avoid
 * opening too many database connections in development (hot-reload) mode.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

module.exports = prisma;
