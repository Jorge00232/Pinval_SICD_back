import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type ProductResponse = {
  codigo: string;
  descrip: string;
  familia: string;
  stock: number;
  stockOriginal: number;
  dataIssue: 'STOCK_NEGATIVO' | null;
  prcosto: number;
  prventa: number;
  minStock: number;
  fecha: string | null;
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
  constructor(private prisma: PrismaService) { }

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
      const stockOriginal = stock.stock ?? 0;

      return {
        codigo,
        descrip: stock.descrip ?? venta?.descrip ?? '',
        familia: venta?.familia ?? 'NO TIENE',
        stock: Math.max(stockOriginal, 0),
        stockOriginal,
        dataIssue: stockOriginal < 0 ? 'STOCK_NEGATIVO' : null,
        prcosto: stock.prcosto ?? venta?.prcosto ?? 0,
        prventa: stock.prventa ?? 0,
        minStock: 5,
        fecha: stock.fecha ? stock.fecha.toISOString() : null,
      };
    });
  }
}
