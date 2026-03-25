/**
 * Prisma seed script – creates a default admin user on first run.
 * Run with: node prisma/seed.js  (or npm run prisma:seed)
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@crm.com';
  const password = 'Admin@123';

  // Check if admin already exists to avoid duplicates
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Admin user already exists, skipping seed.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log(`Admin user created: ${admin.email} (id: ${admin.id})`);
  console.log('Default credentials  →  admin@crm.com / Admin@123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
