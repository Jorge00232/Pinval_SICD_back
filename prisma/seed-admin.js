require('dotenv/config');

const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { PrismaLibSql } = require('@prisma/adapter-libsql');

const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';

const adapter = new PrismaLibSql({
  url: databaseUrl,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'co.arce@duocuc.cl';
  const adminUsername = process.env.ADMIN_USERNAME || 'co.arce';
  const adminName = process.env.ADMIN_NAME || 'Administrador SICD';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const normalizedEmail = adminEmail.toLowerCase().trim();
  const normalizedUsername = adminUsername.toLowerCase().trim();

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: {
      email: normalizedEmail,
    },
    update: {
      username: normalizedUsername,
      name: adminName.trim(),
      role: 'ADMIN',
      passwordHash,
      isActive: true,
      allowGoogle: true,
    },
    create: {
      username: normalizedUsername,
      email: normalizedEmail,
      name: adminName.trim(),
      role: 'ADMIN',
      passwordHash,
      twoFactorSecret: null,
      isActive: true,
      allowGoogle: true,
    },
  });

  console.log('Usuario ADMIN inicial creado o actualizado correctamente:');
  console.log({
    id: admin.id,
    username: admin.username,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    isActive: admin.isActive,
    allowGoogle: admin.allowGoogle,
  });
}

main()
  .catch((error) => {
    console.error('Error creando usuario ADMIN inicial:');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });