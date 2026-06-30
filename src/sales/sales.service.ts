import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import type { Prisma, SaleItem } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canSeeSensitiveData, maskRut } from '../common/mask-sensitive-data';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateSaleBody } from './sales.controller';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeOptionalText(value: unknown) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeCode(code: unknown) {
  const value = normalizeText(code);
  return value.length < 6 ? value.padStart(6, '0') : value;
}

function normalizeCustomerType(value: unknown) {
  const text = normalizeText(value).toUpperCase();

  if (text === 'B2C') {
    return 'B2C';
  }

  return 'B2B';
}

function parseDateInput(value: unknown) {
  const text = normalizeText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new BadRequestException(
      'La fecha de venta es obligatoria y debe tener formato YYYY-MM-DD.',
    );
  }

  const selectedDate = new Date(`${text}T12:00:00`);

  if (Number.isNaN(selectedDate.getTime())) {
    throw new BadRequestException('La fecha de venta no es válida.');
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (selectedDate > today) {
    throw new BadRequestException('La fecha de venta no puede ser futura.');
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

function cleanRut(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();
}

function formatRutIfPossible(value: string | null | undefined) {
  const rawValue = normalizeText(value);

  if (!rawValue) {
    return null;
  }

  const cleanValue = cleanRut(rawValue);

  if (cleanValue.length < 7 || cleanValue.length > 10) {
    return rawValue;
  }

  const body = cleanValue.slice(0, -1);
  const verifier = cleanValue.slice(-1);
  const formattedBody = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${formattedBody}-${verifier}`;
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
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(role?: string | null) {
    const sales = await this.prisma.sale.findMany({
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

    const canSeeFullData = canSeeSensitiveData(role);

    return sales.map((sale) => ({
      id: sale.id,
      date: sale.date,
      customerName: sale.customerName,
      customerType: sale.customerType === 'B2C' ? 'B2C' : 'B2B',
      customerIdentifier: canSeeFullData
        ? sale.customerIdentifier
        : maskRut(sale.customerIdentifier),
      documentType: sale.documentType,
      documentNumber: sale.documentNumber,
      createdBy: sale.createdBy,
      createdByRole: sale.createdByRole,
      createdAt: sale.createdAt,
      isRestricted: !canSeeFullData,
      items: sale.items.map((item) => ({
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

  async create(body: CreateSaleBody, user?: AuthenticatedUser) {
    const date = parseDateInput(body.date);
    const customerName = normalizeText(body.customerName) || 'B2C';
    const customerType = normalizeCustomerType(body.customerType);
    const customerIdentifier = formatRutIfPossible(body.customerIdentifier);
    const documentType = normalizeText(body.documentType) || 'Boleta';
    const documentNumber = normalizeText(body.documentNumber);

    if (!documentNumber) {
      throw new BadRequestException('El número de documento es obligatorio.');
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (rawItems.length === 0) {
      throw new BadRequestException('Debe agregar al menos un producto a la venta.');
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
      const existingSale = await tx.sale.findUnique({
        where: {
          documentNumber,
        },
      });

      if (existingSale) {
        throw new BadRequestException('Ya existe una venta con ese número de documento.');
      }

      const customer = await tx.customer.findFirst({
        where: {
          name: customerName,
          isActive: true,
        },
      });

      for (const [codigo, quantity] of quantityByCode.entries()) {
        const { product } = await getInventoryProductOrFail(tx, codigo);
        const currentStock = product.stock ?? 0;

        if (currentStock < quantity) {
          throw new BadRequestException(
            `Stock insuficiente para ${
              product.displayName || product.descrip || codigo
            }. Disponible: ${currentStock}.`,
          );
        }
      }

      const sale = await tx.sale.create({
        data: {
          date,
          customerId: customer?.id ?? null,
          customerName,
          customerType,
          customerIdentifier,
          documentType,
          documentNumber,
          createdBy: user?.email || user?.username || user?.name || null,
          createdByRole: user?.role ?? null,
        },
      });

      const createdItems: SaleItem[] = [];

      for (const [codigo, quantity] of quantityByCode.entries()) {
        const { codigoAsNumber, product } = await getInventoryProductOrFail(
          tx,
          codigo,
        );

        const currentStock = product.stock ?? 0;
        const stockAfter = currentStock - quantity;
        const unitPrice = product.prventa ?? 0;
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

        const item = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            codigo,
            productName,
            quantity,
            unitPrice,
            totalPrice,
            stockAfter,
          },
        });

        const identifierDetail = customerIdentifier
          ? ` | Id: ${customerIdentifier}`
          : '';

        await tx.inventoryMovement.create({
          data: {
            codigo,
            productName,
            type: 'SALIDA',
            quantity,
            unitPrice,
            totalPrice,
            stockAfter,
            reason:
              `${documentType} ${documentNumber} - ` +
              `${customerName} | Tipo: ${customerType}${identifierDetail}`,
            user: user?.email || user?.username || user?.name || null,
            detail: user?.role ?? null,
          },
        });

        createdItems.push(item);
      }

      if (customer) {
        await tx.customer.update({
          where: {
            id: customer.id,
          },
          data: {
            lastPurchase: formatDateForBusiness(date),
            purchases: {
              increment: 1,
            },
          },
        });
      }

      return {
        id: sale.id,
        date: sale.date,
        customerName: sale.customerName,
        customerType: sale.customerType,
        customerIdentifier: sale.customerIdentifier,
        documentType: sale.documentType,
        documentNumber: sale.documentNumber,
        createdBy: sale.createdBy,
        createdByRole: sale.createdByRole,
        createdAt: sale.createdAt,
        items: createdItems,
      };
    });
  }
}
