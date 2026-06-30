import { BadRequestException, Injectable } from '@nestjs/common';
import type { InventoryMovement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateInventoryMovementBody } from './inventory-movements.controller';

type MovementType = string;

function normalizeCode(code: number | string | null | undefined) {
  if (code === null || code === undefined) {
    return '';
  }

  const value = String(code).trim();
  return value.length < 6 ? value.padStart(6, '0') : value;
}

function normalizeType(type: unknown): MovementType {
  const value = String(type ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');

  if (!value) {
    throw new BadRequestException('El tipo de movimiento es obligatorio.');
  }

  return value;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function parseCreatedAt(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date;
}

@Injectable()
export class InventoryMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(rawCodigo?: string) {
    const codigo = rawCodigo ? normalizeCode(rawCodigo) : '';

    return this.prisma.inventoryMovement.findMany({
      where: codigo ? { codigo } : undefined,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async create(body: CreateInventoryMovementBody | CreateInventoryMovementBody[]) {
    const items = Array.isArray(body) ? body : [body];

    if (items.length === 0) {
      throw new BadRequestException('Debe enviar al menos un movimiento.');
    }

    return this.prisma.$transaction(async (tx) => {
      const createdMovements: InventoryMovement[] = [];

      for (const item of items) {
        const codigo = normalizeCode(item.codigo);
        const codigoAsNumber = Number(codigo);
        const type = normalizeType(item.type);
        const quantity = toNumber(item.quantity);
        const isInventoryOperation = ['ENTRADA', 'SALIDA', 'AJUSTE'].includes(type);

        if (!codigo) {
          throw new BadRequestException('El código del movimiento es obligatorio.');
        }

        if (quantity <= 0) {
          throw new BadRequestException('La cantidad debe ser mayor a 0.');
        }

        if (isInventoryOperation && Number.isNaN(codigoAsNumber)) {
          throw new BadRequestException('El código del producto debe ser numérico.');
        }

        const product = Number.isNaN(codigoAsNumber)
          ? null
          : await tx.stockValorizado.findFirst({
              where: {
                codigo: codigoAsNumber,
              },
            });

        const currentStock = product?.stock ?? 0;

        let calculatedStock: number | null = isInventoryOperation ? currentStock : null;

        if (type === 'ENTRADA') {
          calculatedStock = currentStock + quantity;
        }

        if (type === 'SALIDA') {
          calculatedStock = currentStock - quantity;
        }

        if (type === 'AJUSTE') {
          calculatedStock = item.stockAfter ?? currentStock;
        }

        const unitPrice = toNullableNumber(item.unitPrice);
        const totalPrice =
          toNullableNumber(item.totalPrice) ??
          (unitPrice !== null ? quantity * unitPrice : null);

        if (product && isInventoryOperation && calculatedStock !== null) {
          await tx.stockValorizado.update({
            where: {
              index: product.index,
            },
            data: {
              stock: calculatedStock,
            },
          });
        }

        const movement = await tx.inventoryMovement.create({
          data: {
            codigo,
            productName:
              item.productName?.trim() ||
              product?.displayName ||
              product?.descrip ||
              null,
            type,
            quantity,
            unitPrice,
            totalPrice,
            stockAfter: calculatedStock,
            reason: item.reason?.trim() || null,

            // Auditoría del movimiento
            user: toNullableText(item.user),
            detail: toNullableText(item.detail),

            createdAt: parseCreatedAt(item.createdAt),
          },
        });

        createdMovements.push(movement);
      }

      return {
        created: createdMovements.length,
        movements: createdMovements,
        message: `Se registraron ${createdMovements.length} movimientos de inventario.`,
      };
    });
  }
}