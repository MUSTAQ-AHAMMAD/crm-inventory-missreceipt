/**
 * Prisma seed script – creates a default admin user and seeds Fusion Sales
 * Metadata on first run.
 * Run with: node prisma/seed.js  (or npm run prisma:seed)
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { seedMetadata } = require('./seedFusionMetadata');

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@crm.com';
  const password = 'Admin@123';

  // Check if admin already exists to avoid duplicates
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Admin user already exists, skipping user seed.');
  } else {
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

  // Seed Fusion Sales Metadata (skips if already populated)
  const existingCount = await prisma.fusionSalesMetadata.count();
  if (existingCount > 0) {
    console.log(`Fusion Sales Metadata already seeded (${existingCount} records), skipping.`);
  } else {
    console.log('Seeding Fusion Sales Metadata...');
    await seedMetadata();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
