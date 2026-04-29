import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log('Connected');
  const d = await prisma.stockValorizado.findFirst();
  console.log(d);
}
main().catch(console.error);
