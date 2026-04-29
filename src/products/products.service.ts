import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type ProductResponse = {
  codigo: string;
  descrip: string;
  familia: string;
  stock: number;
  stockReal: number;
  stockIssue: 'NEGATIVE_STOCK' | null;
  prcosto: number;
  prventa: number;
  minStock: number;
};

function normalizeCode(code: number | string | null | undefined) {
  if (code === null || code === undefined) {
    return '';
  }

  const value = String(code).trim();
  return value.length < 6 ? value.padStart(6, '0') : value;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<ProductResponse[]> {
    const [stockRows, ventasRows] = await Promise.all([
      this.prisma.stockValorizado.findMany(),
      this.prisma.ventas.findMany(),
    ]);

    const ventasByCode = new Map(
      ventasRows.map((venta) => [normalizeCode(venta.codint), venta]),
    );

    return stockRows.map((stock) => {
      const codigo = normalizeCode(stock.codigo);
      const venta = ventasByCode.get(codigo);
      const stockReal = stock.stock ?? 0;

      return {
        codigo,
        descrip: stock.descrip ?? venta?.descrip ?? '',
        familia: venta?.familia ?? 'NO TIENE',
        stock: Math.max(stockReal, 0),
        stockReal,
        stockIssue: stockReal < 0 ? 'NEGATIVE_STOCK' : null,
        prcosto: stock.prcosto ?? venta?.prcosto ?? 0,
        prventa: stock.prventa ?? 0,
        minStock: 5,
      };
    });
  }
}
