import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import {
  toDisplayProductName,
  toSearchProductName,
} from '../products/product_normalizer';

export type UploadedExcelFile = {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size?: number;
};

type ExcelRow = Record<string, unknown>;
type ImportType = 'products' | 'customers' | 'suppliers';

type ImportError = {
  row: number;
  reason: string;
};

type ImportSummary = {
  type: ImportType;
  fileName: string;
  totalRows: number;
  processedRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
};

type NormalizedProductRow = {
  codigo: string;
  codigoAsNumber: number;
  descrip: string;
  familia: string | null;
  stock: number;
  prcosto: number | null;
  prventa: number | null;
  fecha: Date | null;
};

type NormalizedCustomerRow = {
  name: string;
  contact: string;
  identifier: string | null;
  customerType: 'B2B' | 'B2C';
};

type NormalizedSupplierRow = {
  name: string;
  identifier: string | null;
  contactName: string;
  phone: string | null;
  email: string | null;
};

const PRODUCT_ALIASES = {
  codigo: ['codigo', 'cod', 'codint', 'sku', 'idproducto', 'codigo producto'],
  descrip: ['descrip', 'descripcion', 'producto', 'nombre', 'nombre producto'],
  familia: ['familia', 'categoria', 'rubro', 'tipo'],
  stock: ['stock', 'existencia', 'cantidad', 'saldo', 'inventario'],
  prcosto: ['prcosto', 'precio costo', 'costo', 'precio de costo', 'valor costo'],
  prventa: ['prventa', 'precio venta', 'venta', 'precio de venta', 'valor venta'],
  fecha: ['fecha', 'fecha actualizacion', 'fecha carga'],
} as const;

const CUSTOMER_ALIASES = {
  name: ['nombre', 'cliente', 'razon social', 'nombre cliente'],
  contact: ['contacto', 'email', 'correo', 'telefono', 'fono'],
  identifier: ['rut', 'identificador', 'documento', 'rut cliente'],
  customerType: ['tipo', 'tipo cliente', 'customer type', 'segmento'],
} as const;

const SUPPLIER_ALIASES = {
  name: ['nombre', 'proveedor', 'razon social', 'nombre proveedor'],
  identifier: ['rut', 'identificador', 'documento', 'rut proveedor'],
  contactName: ['contacto', 'nombre contacto', 'contact name'],
  phone: ['telefono', 'fono', 'celular', 'phone'],
  email: ['email', 'correo', 'mail'],
} as const;

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCode(value: unknown) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/\.0$/, '')
    .replace(/[^0-9]/g, '');

  if (!cleaned) {
    return '';
  }

  return cleaned.length < 6 ? cleaned.padStart(6, '0') : cleaned;
}

function normalizeRut(value: unknown) {
  const rawValue = String(value ?? '').trim();

  if (!rawValue) {
    return null;
  }

  const cleanValue = rawValue.replace(/[^0-9kK]/g, '').toUpperCase();

  if (cleanValue.length < 7 || cleanValue.length > 10) {
    return rawValue;
  }

  const body = cleanValue.slice(0, -1);
  const verifier = cleanValue.slice(-1);
  const formattedBody = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${formattedBody}-${verifier}`;
}

function getRowValue(row: ExcelRow, aliases: readonly string[]) {
  const normalizedRow = new Map<string, unknown>();

  for (const [key, value] of Object.entries(row)) {
    normalizedRow.set(normalizeHeader(key), value);
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);

    if (normalizedRow.has(normalizedAlias)) {
      return normalizedRow.get(normalizedAlias);
    }
  }

  return undefined;
}

function toCleanString(value: unknown) {
  return String(value ?? '').trim();
}

function toNullableString(value: unknown) {
  const cleaned = toCleanString(value);
  return cleaned || null;
}

function toNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value ?? '')
    .trim()
    .replace(/\$/g, '')
    .replace(/CLP/gi, '')
    .replace(/\s/g, '');

  if (!text) {
    return null;
  }

  let normalized = text;

  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d+(,\d+)$/.test(text)) {
    normalized = text.replace(',', '.');
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    normalized = text.replace(/,/g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value: unknown) {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function toDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
  }

  const text = toCleanString(value);

  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function createEmptySummary(
  type: ImportType,
  fileName: string,
  totalRows: number,
): ImportSummary {
  return {
    type,
    fileName,
    totalRows,
    processedRows: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
}

function pushError(summary: ImportSummary, row: number, reason: string) {
  summary.skipped += 1;

  if (summary.errors.length < 100) {
    summary.errors.push({ row, reason });
  }
}

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  async importProducts(file: UploadedExcelFile) {
    const rows = this.getRowsFromExcel(file);
    const summary = createEmptySummary('products', file.originalname, rows.length);

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const product = this.normalizeProductRow(row);

      if (!product.codigo) {
        pushError(summary, rowNumber, 'La fila no tiene codigo de producto.');
        continue;
      }

      if (Number.isNaN(product.codigoAsNumber)) {
        pushError(summary, rowNumber, 'El codigo de producto no es numerico.');
        continue;
      }

      if (!product.descrip) {
        pushError(summary, rowNumber, 'La fila no tiene descripcion de producto.');
        continue;
      }

      try {
        const wasCreated = await this.saveProduct(product);
        summary.processedRows += 1;

        if (wasCreated) {
          summary.created += 1;
        } else {
          summary.updated += 1;
        }
      } catch (error) {
        pushError(
          summary,
          rowNumber,
          error instanceof Error ? error.message : 'No se pudo importar la fila.',
        );
      }
    }

    return summary;
  }

  async importCustomers(file: UploadedExcelFile) {
    const rows = this.getRowsFromExcel(file);
    const summary = createEmptySummary('customers', file.originalname, rows.length);

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const customer = this.normalizeCustomerRow(row);

      if (!customer.name) {
        pushError(summary, rowNumber, 'La fila no tiene nombre de cliente.');
        continue;
      }

      try {
        const wasCreated = await this.saveCustomer(customer);
        summary.processedRows += 1;

        if (wasCreated) {
          summary.created += 1;
        } else {
          summary.updated += 1;
        }
      } catch (error) {
        pushError(
          summary,
          rowNumber,
          error instanceof Error ? error.message : 'No se pudo importar la fila.',
        );
      }
    }

    return summary;
  }

  async importSuppliers(file: UploadedExcelFile) {
    const rows = this.getRowsFromExcel(file);
    const summary = createEmptySummary('suppliers', file.originalname, rows.length);

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const supplier = this.normalizeSupplierRow(row);

      if (!supplier.name) {
        pushError(summary, rowNumber, 'La fila no tiene nombre de proveedor.');
        continue;
      }

      try {
        const wasCreated = await this.saveSupplier(supplier);
        summary.processedRows += 1;

        if (wasCreated) {
          summary.created += 1;
        } else {
          summary.updated += 1;
        }
      } catch (error) {
        pushError(
          summary,
          rowNumber,
          error instanceof Error ? error.message : 'No se pudo importar la fila.',
        );
      }
    }

    return summary;
  }

  private getRowsFromExcel(file: UploadedExcelFile) {
    const workbook = XLSX.read(file.buffer, {
      type: 'buffer',
      cellDates: true,
    });

    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      throw new BadRequestException('El archivo Excel no tiene hojas.');
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(worksheet, {
      defval: null,
      raw: false,
    });

    if (!rows.length) {
      throw new BadRequestException('El archivo Excel no tiene datos para importar.');
    }

    return rows;
  }

  private normalizeProductRow(row: ExcelRow): NormalizedProductRow {
    const codigo = normalizeCode(getRowValue(row, PRODUCT_ALIASES.codigo));
    const stock = toInteger(getRowValue(row, PRODUCT_ALIASES.stock)) ?? 0;
    const prcosto = toNumber(getRowValue(row, PRODUCT_ALIASES.prcosto));
    const prventa = toInteger(getRowValue(row, PRODUCT_ALIASES.prventa));
    const rawDescription = toCleanString(getRowValue(row, PRODUCT_ALIASES.descrip));

    return {
      codigo,
      codigoAsNumber: Number(codigo),
      descrip: rawDescription,
      familia: toNullableString(getRowValue(row, PRODUCT_ALIASES.familia)),
      stock,
      prcosto,
      prventa,
      fecha: toDate(getRowValue(row, PRODUCT_ALIASES.fecha)),
    };
  }

  private normalizeCustomerRow(row: ExcelRow): NormalizedCustomerRow {
    const rawType = toCleanString(getRowValue(row, CUSTOMER_ALIASES.customerType)).toUpperCase();
    const customerType = rawType.includes('B2C') || rawType.includes('PERSONA') || rawType.includes('NATURAL')
      ? 'B2C'
      : 'B2B';

    return {
      name: toCleanString(getRowValue(row, CUSTOMER_ALIASES.name)),
      contact:
        toCleanString(getRowValue(row, CUSTOMER_ALIASES.contact)) || 'Sin informacion',
      identifier: normalizeRut(getRowValue(row, CUSTOMER_ALIASES.identifier)),
      customerType,
    };
  }

  private normalizeSupplierRow(row: ExcelRow): NormalizedSupplierRow {
    const name = toCleanString(getRowValue(row, SUPPLIER_ALIASES.name));

    return {
      name,
      identifier: normalizeRut(getRowValue(row, SUPPLIER_ALIASES.identifier)),
      contactName:
        toCleanString(getRowValue(row, SUPPLIER_ALIASES.contactName)) ||
        'Sin informacion',
      phone: toNullableString(getRowValue(row, SUPPLIER_ALIASES.phone)),
      email: toNullableString(getRowValue(row, SUPPLIER_ALIASES.email)),
    };
  }

  private async saveProduct(product: NormalizedProductRow) {
    const displayName = toDisplayProductName(product.descrip);
    const searchName = toSearchProductName(product.descrip);
    const totalBySalePrice = Math.round(product.stock * (product.prventa ?? 0));
    const totalByCostPrice = Math.round(product.stock * (product.prcosto ?? 0));

    const existingStock = await this.prisma.stockValorizado.findFirst({
      where: {
        codigo: product.codigoAsNumber,
      },
      orderBy: {
        index: 'asc',
      },
    });

    await this.prisma.$transaction(async (tx) => {
      if (existingStock) {
        await tx.stockValorizado.updateMany({
          where: {
            codigo: product.codigoAsNumber,
          },
          data: {
            descrip: product.descrip,
            displayName,
            searchName,
            stock: product.stock,
            prcosto: product.prcosto,
            prventa: product.prventa,
            sbtotal: totalBySalePrice,
            sbtot: totalByCostPrice,
            fecha: product.fecha,
          },
        });
      } else {
        await tx.stockValorizado.create({
          data: {
            codigo: product.codigoAsNumber,
            descrip: product.descrip,
            displayName,
            searchName,
            stock: product.stock,
            prcosto: product.prcosto,
            prventa: product.prventa,
            sbtotal: totalBySalePrice,
            sbtot: totalByCostPrice,
            fecha: product.fecha,
          },
        });
      }

      const existingVenta = await tx.ventas.findFirst({
        where: {
          codint: product.codigo,
        },
      });

      if (existingVenta) {
        await tx.ventas.updateMany({
          where: {
            codint: product.codigo,
          },
          data: {
            descrip: product.descrip,
            stock: product.stock,
            familia: product.familia,
            prcosto: product.prcosto,
          },
        });
      } else {
        await tx.ventas.create({
          data: {
            codint: product.codigo,
            descrip: product.descrip,
            cantidad: 0,
            stock: product.stock,
            familia: product.familia,
            prcosto: product.prcosto,
          },
        });
      }

      const previousStock = existingStock?.stock ?? 0;
      const stockDifference = product.stock - previousStock;

      await tx.inventoryMovement.create({
        data: {
          codigo: product.codigo,
          productName: displayName,
          type: 'AJUSTE',
          quantity: Math.abs(stockDifference),
          unitPrice: product.prcosto,
          totalPrice:
            product.prcosto !== null
              ? Math.abs(stockDifference) * product.prcosto
              : null,
          stockAfter: product.stock,
          reason: 'Carga masiva Excel',
          user: 'Sistema',
          detail: existingStock
            ? `Stock actualizado por carga masiva. Stock anterior: ${previousStock}. Stock nuevo: ${product.stock}.`
            : `Producto creado por carga masiva. Stock inicial: ${product.stock}.`,
        },
      });
    });

    return !existingStock;
  }

  private async saveCustomer(customer: NormalizedCustomerRow) {
    const existingCustomer = await this.prisma.customer.findFirst({
      where: customer.identifier
        ? {
            identifier: customer.identifier,
          }
        : {
            name: customer.name,
          },
    });

    if (existingCustomer) {
      await this.prisma.customer.update({
        where: {
          id: existingCustomer.id,
        },
        data: {
          name: customer.name,
          contact: customer.contact,
          identifier: customer.identifier,
          customerType: customer.customerType,
          isActive: true,
        },
      });

      return false;
    }

    await this.prisma.customer.create({
      data: {
        name: customer.name,
        contact: customer.contact,
        identifier: customer.identifier,
        customerType: customer.customerType,
        isActive: true,
      },
    });

    return true;
  }

  private async saveSupplier(supplier: NormalizedSupplierRow) {
    const existingSupplier = await this.prisma.supplier.findFirst({
      where: supplier.identifier
        ? {
            identifier: supplier.identifier,
          }
        : {
            name: supplier.name,
          },
    });

    if (existingSupplier) {
      await this.prisma.supplier.update({
        where: {
          id: existingSupplier.id,
        },
        data: {
          name: supplier.name,
          identifier: supplier.identifier,
          contactName: supplier.contactName,
          phone: supplier.phone,
          email: supplier.email,
          isActive: true,
        },
      });

      return false;
    }

    await this.prisma.supplier.create({
      data: {
        name: supplier.name,
        identifier: supplier.identifier,
        contactName: supplier.contactName,
        phone: supplier.phone,
        email: supplier.email,
        isActive: true,
      },
    });

    return true;
  }
}
