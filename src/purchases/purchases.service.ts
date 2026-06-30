import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import type { Prisma, PurchaseItem } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePurchaseBody } from './purchases.controller';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeCode(code: unknown) {
  const value = normalizeText(code);
  return value.length < 6 ? value.padStart(6, '0') : value;
}

function parseDateInput(value: unknown) {
  const text = normalizeText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new BadRequestException(
      'La fecha de compra es obligatoria y debe tener formato YYYY-MM-DD.',
    );
  }

  const selectedDate = new Date(`${text}T12:00:00`);

  if (Number.isNaN(selectedDate.getTime())) {
    throw new BadRequestException('La fecha de compra no es válida.');
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (selectedDate > today) {
    throw new BadRequestException('La fecha de compra no puede ser futura.');
  }

  return selectedDate;
}

function formatDateForBusiness(date: Date) {
  return date.toLocaleDateString('es-CL');
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStockUpdateData(
  stockAfter: number,
  product: {
    prventa: number | null;
    prcosto: number | null;
  },
): Prisma.StockValorizadoUpdateManyMutationInput {
  const data: Prisma.StockValorizadoUpdateManyMutationInput = {
    stock: stockAfter,
  };

  if (typeof product.prventa === 'number') {
    data.sbtotal = Math.round(stockAfter * product.prventa);
  }

  if (typeof product.prcosto === 'number') {
    data.sbtot = Math.round(stockAfter * product.prcosto);
  }

  return data;
}

async function getInventoryProductOrFail(
  tx: Prisma.TransactionClient,
  codigo: string,
) {
  const codigoAsNumber = Number(codigo);

  if (Number.isNaN(codigoAsNumber)) {
    throw new BadRequestException(`El código ${codigo} no es numérico.`);
  }

  const product = await tx.stockValorizado.findFirst({
    where: {
      codigo: codigoAsNumber,
    },
    orderBy: {
      index: 'asc',
    },
  });

  if (!product) {
    throw new BadRequestException(`El producto ${codigo} no existe en inventario.`);
  }

  return {
    codigoAsNumber,
    product,
  };
}

async function updateInventoryStock(
  tx: Prisma.TransactionClient,
  params: {
    codigo: string;
    codigoAsNumber: number;
    stockAfter: number;
    product: {
      prventa: number | null;
      prcosto: number | null;
    };
  },
) {
  const updatedStockRows = await tx.stockValorizado.updateMany({
    where: {
      codigo: params.codigoAsNumber,
    },
    data: getStockUpdateData(params.stockAfter, params.product),
  });

  await tx.ventas.updateMany({
    where: {
      codint: params.codigo,
    },
    data: {
      stock: params.stockAfter,
    },
  });

  return updatedStockRows.count;
}

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const purchases = await this.prisma.purchase.findMany({
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          date: 'desc',
        },
      ],
      include: {
        items: true,
      },
    });

    return purchases.map((purchase) => ({
      id: purchase.id,
      date: purchase.date,
      supplierName: purchase.supplierName,
      documentNumber: purchase.documentNumber,
      createdBy: purchase.createdBy,
      createdByRole: purchase.createdByRole,
      createdAt: purchase.createdAt,
      items: purchase.items.map((item) => ({
        id: item.id,
        codigo: item.codigo,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        stockAfter: item.stockAfter,
      })),
    }));
  }

  async create(body: CreatePurchaseBody, user?: AuthenticatedUser) {
    const date = parseDateInput(body.date);
    const supplierName = normalizeText(body.supplierName);
    const documentNumber = normalizeText(body.documentNumber);

    if (!supplierName) {
      throw new BadRequestException('El proveedor es obligatorio.');
    }

    if (!documentNumber) {
      throw new BadRequestException('El número de documento es obligatorio.');
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (rawItems.length === 0) {
      throw new BadRequestException('Debe agregar al menos un producto a la compra.');
    }

    const quantityByCode = new Map<string, number>();

    for (const item of rawItems) {
      const codigo = normalizeCode(item.codigo);
      const quantity = toNumber(item.quantity);

      if (!codigo) {
        throw new BadRequestException('Todas las líneas deben tener producto.');
      }

      if (quantity <= 0) {
        throw new BadRequestException('La cantidad debe ser mayor a 0.');
      }

      quantityByCode.set(codigo, (quantityByCode.get(codigo) ?? 0) + quantity);
    }

    return this.prisma.$transaction(async (tx) => {
      const existingPurchase = await tx.purchase.findUnique({
        where: {
          documentNumber,
        },
      });

      if (existingPurchase) {
        throw new BadRequestException('Ya existe una compra con ese número de documento.');
      }

      const supplier = await tx.supplier.findFirst({
        where: {
          name: supplierName,
          isActive: true,
        },
      });

      const purchase = await tx.purchase.create({
        data: {
          date,
          supplierId: supplier?.id ?? null,
          supplierName,
          documentNumber,
          createdBy: user?.email || user?.username || user?.name || null,
          createdByRole: user?.role ?? null,
        },
      });

      const createdItems: PurchaseItem[] = [];

      for (const [codigo, quantity] of quantityByCode.entries()) {
        const { codigoAsNumber, product } = await getInventoryProductOrFail(
          tx,
          codigo,
        );

        const currentStock = product.stock ?? 0;
        const stockAfter = currentStock + quantity;
        const unitPrice = product.prcosto ?? 0;
        const totalPrice = quantity * unitPrice;
        const productName =
          product.displayName || product.descrip || `Producto ${codigo}`;

        const updatedRows = await updateInventoryStock(tx, {
          codigo,
          codigoAsNumber,
          stockAfter,
          product,
        });

        if (updatedRows === 0) {
          throw new BadRequestException(
            `No se pudo actualizar el stock del producto ${codigo}.`,
          );
        }

        const item = await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            codigo,
            productName,
            quantity,
            unitPrice,
            totalPrice,
            stockAfter,
          },
        });

        await tx.inventoryMovement.create({
          data: {
            codigo,
            productName,
            type: 'ENTRADA',
            quantity,
            unitPrice,
            totalPrice,
            stockAfter,
            reason: `Factura ${documentNumber} - ${supplierName}`,
            user: user?.email || user?.username || user?.name || null,
            detail: user?.role ?? null,
          },
        });

        createdItems.push(item);
      }

      if (supplier) {
        await tx.supplier.update({
          where: {
            id: supplier.id,
          },
          data: {
            lastPurchase: formatDateForBusiness(date),
            totalPurchases: {
              increment: 1,
            },
          },
        });
      }

      return {
        id: purchase.id,
        date: purchase.date,
        supplierName: purchase.supplierName,
        documentNumber: purchase.documentNumber,
        createdBy: purchase.createdBy,
        createdByRole: purchase.createdByRole,
        createdAt: purchase.createdAt,
        items: createdItems,
      };
    });
  }
}
