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

async function upsertUser({ email, username, name, role, password }) {
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      username,
      name,
      role,
      passwordHash,
      isActive: true,
      allowGoogle: true,
      twoFactorSecret: null,
    },
    create: {
      email,
      username,
      name,
      role,
      passwordHash,
      isActive: true,
      allowGoogle: true,
      twoFactorSecret: null,
    },
  });

  console.log(`OK: ${user.email} | ${user.username} | ${user.role}`);
}

async function main() {
  await upsertUser({
    email: 'josu.campusano@duocuc.cl',
    username: 'jo.campusano',
    name: 'Josue Campusano',
    role: 'ADMIN',
    password: 'admin123',
  });

  await upsertUser({
    email: 'sa.mora@duocuc.cl',
    username: 'sa.mora',
    name: 'SA Mora',
    role: 'STOCK',
    password: 'stock1234',
  });

  console.log('Usuarios agregados correctamente sin borrar los existentes.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    prisma.$disconnect();
  });
