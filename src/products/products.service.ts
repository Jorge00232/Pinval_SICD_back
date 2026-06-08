import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  toDisplayProductName,
  toSearchProductName,
} from './product_normalizer';

export type ProductResponse = {
  codigo: string;
  descrip: string;
  displayName: string;
  searchName: string;
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

function resolveProductName(
  stockName?: string | null,
  ventaName?: string | null,
) {
  return stockName?.trim() || ventaName?.trim() || '';
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

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

      const originalName = resolveProductName(stock.descrip, venta?.descrip);

      const displayName =
        stock.displayName?.trim() || toDisplayProductName(originalName);

      const searchName =
        stock.searchName?.trim() || toSearchProductName(originalName);

      return {
        codigo,
        descrip: originalName,
        displayName,
        searchName,
        familia: venta?.familia?.trim() || 'NO TIENE',
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

  async normalizeExistingProductNames() {
    const stockRows = await this.prisma.stockValorizado.findMany();

    let updated = 0;

    for (const stock of stockRows) {
      const originalName = stock.descrip?.trim();

      if (!originalName) {
        continue;
      }

      const displayName = toDisplayProductName(originalName);
      const searchName = toSearchProductName(originalName);

      await this.prisma.stockValorizado.update({
        where: {
          index: stock.index,
        },
        data: {
          displayName,
          searchName,
        },
      });

      updated += 1;
    }

    return {
      updated,
      message: `Se normalizaron ${updated} productos.`,
    };
  }
}