import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, StockValorizado, Ventas } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  toDisplayProductName,
  toSearchProductName,
} from './product_normalizer';
import type { CreateProductBody, UpdateProductBody } from './products.controller';

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

type AuditActor = {
  email?: string | null;
  username?: string | null;
  name?: string | null;
  role?: string | null;
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

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeOptionalText(value: unknown) {
  const text = normalizeText(value);
  return text || null;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function parseDateForCreate(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return new Date();
  }

  const date = new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('La fecha del producto no tiene un formato válido.');
  }

  return date;
}

function parseDateForUpdate(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const date = new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('La fecha del producto no tiene un formato válido.');
  }

  return date;
}

function getActorLabel(actor?: AuditActor | null) {
  return (
    actor?.email?.trim() ||
    actor?.username?.trim() ||
    actor?.name?.trim() ||
    'Sistema SICD'
  );
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

      return this.toProductResponse(stock, venta);
    });
  }

  async create(
    body: CreateProductBody,
    actor?: AuditActor | null,
  ): Promise<ProductResponse> {
    const codigo = normalizeCode(body.codigo);
    const codigoAsNumber = Number(codigo);

    if (!codigo) {
      throw new BadRequestException('El código del producto es obligatorio.');
    }

    if (Number.isNaN(codigoAsNumber)) {
      throw new BadRequestException('El código del producto debe ser numérico.');
    }

    const descrip = normalizeText(body.descrip);

    if (!descrip) {
      throw new BadRequestException('La descripción del producto es obligatoria.');
    }

    const existingProduct = await this.prisma.stockValorizado.findFirst({
      where: {
        codigo: codigoAsNumber,
      },
    });

    if (existingProduct) {
      throw new ConflictException('Ya existe un producto con ese código.');
    }

    const stock = Math.max(toInt(body.stock, 0), 0);
    const prventa = Math.max(toInt(body.prventa, 0), 0);
    const prcosto = Math.max(toNumber(body.prcosto, 0), 0);
    const familia = normalizeOptionalText(body.familia) ?? 'NO TIENE';
    const displayName = toDisplayProductName(descrip);
    const searchName = toSearchProductName(descrip);
    const fecha = parseDateForCreate(body.fecha);

    const result = await this.prisma.$transaction(async (tx) => {
      const stockRow = await tx.stockValorizado.create({
        data: {
          codigo: codigoAsNumber,
          descrip,
          displayName,
          searchName,
          stock,
          prventa,
          sbtotal: stock * prventa,
          prcosto,
          sbtot: Math.round(stock * prcosto),
          fecha,
        },
      });

      const ventaRow = await this.createOrUpdateVentaRow(tx, codigo, {
        descrip,
        familia,
        prcosto,
        stock,
      });

      await this.registerProductMovement(tx, 'PRODUCTO_CREADO', stockRow, ventaRow, actor);

      return {
        stockRow,
        ventaRow,
      };
    });

    return this.toProductResponse(result.stockRow, result.ventaRow);
  }

  async update(
    rawCodigo: string,
    body: UpdateProductBody,
    actor?: AuditActor | null,
  ): Promise<ProductResponse> {
    const codigo = normalizeCode(rawCodigo || body.codigo);
    const codigoAsNumber = Number(codigo);

    if (!codigo) {
      throw new BadRequestException('El código del producto es obligatorio.');
    }

    if (Number.isNaN(codigoAsNumber)) {
      throw new BadRequestException('El código del producto debe ser numérico.');
    }

    const currentProduct = await this.prisma.stockValorizado.findFirst({
      where: {
        codigo: codigoAsNumber,
      },
    });

    if (!currentProduct) {
      throw new NotFoundException('Producto no encontrado.');
    }

    const currentVenta = await this.prisma.ventas.findFirst({
      where: {
        codint: codigo,
      },
    });

    const nextDescription =
      body.descrip !== undefined
        ? normalizeText(body.descrip)
        : resolveProductName(currentProduct.descrip, currentVenta?.descrip);

    if (!nextDescription) {
      throw new BadRequestException('La descripción del producto es obligatoria.');
    }

    const nextStock =
      body.stock !== undefined
        ? Math.max(toInt(body.stock, currentProduct.stock ?? 0), 0)
        : currentProduct.stock ?? 0;

    const nextPrventa =
      body.prventa !== undefined
        ? Math.max(toInt(body.prventa, currentProduct.prventa ?? 0), 0)
        : currentProduct.prventa ?? 0;

    const nextPrcosto =
      body.prcosto !== undefined
        ? Math.max(toNumber(body.prcosto, currentProduct.prcosto ?? 0), 0)
        : currentProduct.prcosto ?? currentVenta?.prcosto ?? 0;

    const nextFamilia =
      body.familia !== undefined
        ? normalizeOptionalText(body.familia) ?? 'NO TIENE'
        : currentVenta?.familia?.trim() || 'NO TIENE';

    const nextFecha = parseDateForUpdate(body.fecha);
    const displayName = toDisplayProductName(nextDescription);
    const searchName = toSearchProductName(nextDescription);

    const result = await this.prisma.$transaction(async (tx) => {
      const stockData: Prisma.StockValorizadoUpdateInput = {
        descrip: nextDescription,
        displayName,
        searchName,
        stock: nextStock,
        prventa: nextPrventa,
        sbtotal: nextStock * nextPrventa,
        prcosto: nextPrcosto,
        sbtot: Math.round(nextStock * nextPrcosto),
      };

      if (nextFecha !== undefined) {
        stockData.fecha = nextFecha;
      }

      const stockRow = await tx.stockValorizado.update({
        where: {
          index: currentProduct.index,
        },
        data: stockData,
      });

      const ventaRow = await this.createOrUpdateVentaRow(tx, codigo, {
        descrip: nextDescription,
        familia: nextFamilia,
        prcosto: nextPrcosto,
        stock: nextStock,
      });

      await this.registerProductMovement(
        tx,
        'PRODUCTO_ACTUALIZADO',
        stockRow,
        ventaRow,
        actor,
        currentProduct.stock ?? 0,
      );

      return {
        stockRow,
        ventaRow,
      };
    });

    return this.toProductResponse(result.stockRow, result.ventaRow);
  }

  async getExistenceCard(rawCodigo: string): Promise<ExistenceCardResponse> {
    const codigo = normalizeCode(rawCodigo);

    if (!codigo) {
      throw new NotFoundException('Código de producto no válido.');
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
        `No se encontró información para el producto ${codigo}.`,
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

  private async createOrUpdateVentaRow(
    tx: Prisma.TransactionClient,
    codigo: string,
    data: {
      descrip: string;
      familia: string;
      prcosto: number;
      stock: number;
    },
  ) {
    const existingVenta = await tx.ventas.findFirst({
      where: {
        codint: codigo,
      },
    });

    if (existingVenta) {
      return tx.ventas.update({
        where: {
          index: existingVenta.index,
        },
        data: {
          descrip: data.descrip,
          familia: data.familia,
          prcosto: data.prcosto,
          stock: data.stock,
        },
      });
    }

    return tx.ventas.create({
      data: {
        codint: codigo,
        descrip: data.descrip,
        familia: data.familia,
        prcosto: data.prcosto,
        stock: data.stock,
        cantidad: 0,
      },
    });
  }

  private async registerProductMovement(
    tx: Prisma.TransactionClient,
    type: 'PRODUCTO_CREADO' | 'PRODUCTO_ACTUALIZADO',
    stock: StockValorizado,
    venta: Ventas | null,
    actor?: AuditActor | null,
    previousStock?: number,
  ) {
    const codigo = normalizeCode(stock.codigo);
    const productName =
      stock.displayName?.trim() ||
      stock.descrip?.trim() ||
      venta?.descrip?.trim() ||
      `Producto ${codigo}`;

    const actionLabel =
      type === 'PRODUCTO_CREADO' ? 'Producto creado' : 'Producto actualizado';

    const familia = venta?.familia?.trim() || 'NO TIENE';
    const stockLabel =
      previousStock === undefined
        ? `Stock inicial: ${stock.stock ?? 0}`
        : `Stock anterior: ${previousStock} | Stock actual: ${stock.stock ?? 0}`;

    await tx.inventoryMovement.create({
      data: {
        codigo,
        productName,
        type,
        quantity: 1,
        unitPrice: stock.prcosto ?? null,
        totalPrice: null,
        stockAfter: stock.stock ?? null,
        reason: actionLabel,
        user: getActorLabel(actor),
        detail: `${actionLabel}: ${productName} | Código: ${codigo} | Categoría: ${familia} | ${stockLabel} | Precio costo: ${stock.prcosto ?? 0} | Precio venta: ${stock.prventa ?? 0}`,
      },
    });
  }

  private toProductResponse(stock: StockValorizado, venta?: Ventas | null): ProductResponse {
    const codigo = normalizeCode(stock.codigo);
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
  }
}
