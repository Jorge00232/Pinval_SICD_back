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

function normalizeCode(code) {
  const value = String(code ?? '').trim();
  return value.length < 6 ? value.padStart(6, '0') : value;
}

async function main() {
  const latestMovements = await prisma.inventoryMovement.findMany({
    orderBy: {
      createdAt: 'asc',
    },
  });

  const latestStockByCode = new Map();

  for (const movement of latestMovements) {
    const codigo = normalizeCode(movement.codigo);

    if (!codigo || movement.stockAfter === null || movement.stockAfter === undefined) {
      continue;
    }

    latestStockByCode.set(codigo, movement.stockAfter);
  }

  let updatedCodes = 0;
  let updatedRows = 0;

  for (const [codigo, stockAfter] of latestStockByCode.entries()) {
    const codigoAsNumber = Number(codigo);

    if (Number.isNaN(codigoAsNumber)) {
      console.warn(`Código no numérico omitido: ${codigo}`);
      continue;
    }

    const stockRows = await prisma.stockValorizado.findMany({
      where: {
        codigo: codigoAsNumber,
      },
    });

    if (stockRows.length === 0) {
      console.warn(`No existe producto en stockvalorizado para código ${codigo}`);
      continue;
    }

    const baseRow = stockRows[0];

    const data = {
      stock: stockAfter,
    };

    if (typeof baseRow.prventa === 'number') {
      data.sbtotal = Math.round(stockAfter * baseRow.prventa);
    }

    if (typeof baseRow.prcosto === 'number') {
      data.sbtot = Math.round(stockAfter * baseRow.prcosto);
    }

    const result = await prisma.stockValorizado.updateMany({
      where: {
        codigo: codigoAsNumber,
      },
      data,
    });

    await prisma.ventas.updateMany({
      where: {
        codint: codigo,
      },
      data: {
        stock: stockAfter,
      },
    });

    updatedCodes += 1;
    updatedRows += result.count;
  }

  console.log('Sincronización de stock terminada.');
  console.log({
    codigosActualizados: updatedCodes,
    filasStockValorizadoActualizadas: updatedRows,
  });
}

main()
  .catch((error) => {
    console.error('Error sincronizando stock desde movimientos:');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
