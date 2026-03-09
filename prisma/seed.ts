import { PrismaClient, Role } from '../src/generated/prisma/client/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME;

  if (!email || !password || !name) {
    throw new Error(
      'Missing ADMIN_EMAIL, ADMIN_PASSWORD or ADMIN_NAME in environment',
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`⚠️  Admin already exists: ${email}`);
    return;
  }

  const hashed = await bcrypt.hash(password, 10);

  const admin = await prisma.user.create({
    data: {
      email: email.toLowerCase().trim(),
      password: hashed,
      name,
      role: Role.ADMIN,
    },
  });

  console.log(`✅ Admin created: ${admin.email} (id: ${admin.id})`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
