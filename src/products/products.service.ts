import { Injectable, NotFoundException } from '@nestjs/common';
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

type ExistenceCardMovement = {
  id: number;
  fecha: string;
  detalle: string;
  entrada: number;
  salida: number;
  stockTotal: number | null;
  precioUnitario: number | null;
  total: number | null;
};

type ExistenceCardResponse = {
  codigo: string;
  descrip: string;
  displayName: string;
  searchName: string;
  familia: string;
  currentStock: number;
  stockOriginal: number;
  dataIssue: 'STOCK_NEGATIVO' | null;
  totalEntradas: number;
  totalSalidas: number;
  prcosto: number;
  prventa: number;
  stockValueBySalePrice: number;
  stockValueByCostPrice: number;
  movements: ExistenceCardMovement[];
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

function normalizeMovementType(type: string | null | undefined) {
  return String(type ?? '').trim().toUpperCase();
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

  async getExistenceCard(rawCodigo: string): Promise<ExistenceCardResponse> {
    const codigo = normalizeCode(rawCodigo);

    if (!codigo) {
      throw new NotFoundException('Codigo de producto no valido.');
    }

    const codigoAsNumber = Number(codigo);

    const [stock, venta, movements] = await Promise.all([
      Number.isNaN(codigoAsNumber)
        ? null
        : this.prisma.stockValorizado.findFirst({
            where: {
              codigo: codigoAsNumber,
            },
          }),
      this.prisma.ventas.findFirst({
        where: {
          codint: codigo,
        },
      }),
      this.prisma.inventoryMovement.findMany({
        where: {
          codigo,
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
    ]);

    if (!stock && !venta) {
      throw new NotFoundException(
        `No se encontro informacion para el producto ${codigo}.`,
      );
    }

    const stockOriginal = stock?.stock ?? venta?.stock ?? 0;
    const currentStock = Math.max(stockOriginal, 0);
    const originalName = resolveProductName(stock?.descrip, venta?.descrip);

    const displayName =
      stock?.displayName?.trim() || toDisplayProductName(originalName);

    const searchName =
      stock?.searchName?.trim() || toSearchProductName(originalName);

    const prcosto = stock?.prcosto ?? venta?.prcosto ?? 0;
    const prventa = stock?.prventa ?? 0;

    let runningStock = 0;

    const cardMovements: ExistenceCardMovement[] = movements.map((movement) => {
      const movementType = normalizeMovementType(movement.type);
      const quantity = movement.quantity ?? 0;

      const entrada = movementType === 'ENTRADA' ? quantity : 0;
      const salida = movementType === 'SALIDA' ? quantity : 0;

      runningStock += entrada;
      runningStock -= salida;

      const stockTotal = movement.stockAfter ?? runningStock;
      const precioUnitario = movement.unitPrice ?? null;
      const total =
        movement.totalPrice ??
        (precioUnitario !== null ? quantity * precioUnitario : null);

      return {
        id: movement.id,
        fecha: movement.createdAt.toISOString(),
        detalle: movement.reason?.trim() || movementType || 'MOVIMIENTO',
        entrada,
        salida,
        stockTotal,
        precioUnitario,
        total,
      };
    });

    const totalEntradas = cardMovements.reduce(
      (sum, movement) => sum + movement.entrada,
      0,
    );

    const totalSalidas = cardMovements.reduce(
      (sum, movement) => sum + movement.salida,
      0,
    );

    return {
      codigo,
      descrip: originalName,
      displayName,
      searchName,
      familia: venta?.familia?.trim() || 'NO TIENE',
      currentStock,
      stockOriginal,
      dataIssue: stockOriginal < 0 ? 'STOCK_NEGATIVO' : null,
      totalEntradas,
      totalSalidas,
      prcosto,
      prventa,
      stockValueBySalePrice: currentStock * prventa,
      stockValueByCostPrice: currentStock * prcosto,
      movements: cardMovements,
    };
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