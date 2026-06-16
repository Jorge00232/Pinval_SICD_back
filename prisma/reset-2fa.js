require('dotenv/config');

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
  const email = process.env.RESET_2FA_EMAIL || 'co.arce@duocuc.cl';

  const user = await prisma.user.update({
    where: {
      email: email.toLowerCase().trim(),
    },
    data: {
      twoFactorSecret: null,
    },
  });

  console.log('2FA reseteado correctamente:');
  console.log({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    twoFactorSecret: user.twoFactorSecret,
  });
}

main()
  .catch((error) => {
    console.error('Error reseteando 2FA:');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });