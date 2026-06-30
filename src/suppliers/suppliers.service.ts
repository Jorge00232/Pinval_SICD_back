import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Supplier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  canSeeSensitiveData,
  maskRut,
  restrictedValue,
} from '../common/mask-sensitive-data';
import type {
  CreateSupplierBody,
  UpdateSupplierBody,
} from './suppliers.controller';

type AuditActor = {
  email?: string | null;
  username?: string | null;
  name?: string | null;
  role?: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeOptionalText(value: unknown) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeEmail(value: unknown) {
  const text = normalizeOptionalText(value);

  if (!text) {
    return null;
  }

  const normalizedEmail = text.toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new BadRequestException('El correo del proveedor no tiene un formato válido.');
  }

  return normalizedEmail;
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
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(role?: string | null) {
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return suppliers.map((supplier) => this.toResponse(supplier, role));
  }

  async create(body: CreateSupplierBody, actor?: AuditActor | null) {
    const name = normalizeText(body.name);

    if (!name) {
      throw new BadRequestException('El nombre del proveedor es obligatorio.');
    }

    const supplier = await this.prisma.supplier.create({
      data: {
        name,
        identifier: normalizeOptionalText(body.identifier),
        contactName: normalizeOptionalText(body.contactName),
        phone: normalizeOptionalText(body.phone),
        email: normalizeEmail(body.email),
        lastPurchase: 'Sin compras',
        totalPurchases: 0,
        isActive: true,
      },
    });

    await this.registerSupplierMovement('PROVEEDOR_CREADO', supplier, actor);

    return this.toResponse(supplier, 'ADMIN');
  }

  async update(id: string, body: UpdateSupplierBody, actor?: AuditActor | null) {
    const cleanId = normalizeText(id);

    if (!cleanId) {
      throw new BadRequestException('El id del proveedor es obligatorio.');
    }

    const currentSupplier = await this.prisma.supplier.findUnique({
      where: {
        id: cleanId,
      },
    });

    if (!currentSupplier) {
      throw new NotFoundException('Proveedor no encontrado.');
    }

    const data: {
      name?: string;
      identifier?: string | null;
      contactName?: string | null;
      phone?: string | null;
      email?: string | null;
      isActive?: boolean;
    } = {};

    if (body.name !== undefined) {
      const name = normalizeText(body.name);

      if (!name) {
        throw new BadRequestException('El nombre del proveedor es obligatorio.');
      }

      data.name = name;
    }

    if (body.identifier !== undefined) {
      data.identifier = normalizeOptionalText(body.identifier);
    }

    if (body.contactName !== undefined) {
      data.contactName = normalizeOptionalText(body.contactName);
    }

    if (body.phone !== undefined) {
      data.phone = normalizeOptionalText(body.phone);
    }

    if (body.email !== undefined) {
      data.email = normalizeEmail(body.email);
    }

    if (body.isActive !== undefined) {
      data.isActive = Boolean(body.isActive);
    }

    const updatedSupplier = await this.prisma.supplier.update({
      where: {
        id: cleanId,
      },
      data,
    });

    await this.registerSupplierMovement('PROVEEDOR_ACTUALIZADO', updatedSupplier, actor);

    return this.toResponse(updatedSupplier, 'ADMIN');
  }

  private async registerSupplierMovement(
    type: 'PROVEEDOR_CREADO' | 'PROVEEDOR_ACTUALIZADO',
    supplier: Supplier,
    actor?: AuditActor | null,
  ) {
    const actionLabel = type === 'PROVEEDOR_CREADO' ? 'Proveedor creado' : 'Proveedor actualizado';
    const statusLabel = supplier.isActive ? 'Activo' : 'Inactivo';
    const identifier = supplier.identifier ? ` | RUT: ${supplier.identifier}` : '';
    const email = supplier.email ? ` | Correo: ${supplier.email}` : '';

    await this.prisma.inventoryMovement.create({
      data: {
        codigo: 'PROVEEDOR',
        productName: supplier.name,
        type,
        quantity: 1,
        unitPrice: null,
        totalPrice: null,
        stockAfter: null,
        reason: actionLabel,
        user: getActorLabel(actor),
        detail: `${actionLabel}: ${supplier.name}${identifier}${email} | Estado: ${statusLabel}`,
      },
    });
  }

  private toResponse(supplier: Supplier, role?: string | null) {
    const canSeeFullData = canSeeSensitiveData(role);

    return {
      id: supplier.id,
      name: supplier.name,
      identifier: canSeeFullData
        ? supplier.identifier
        : maskRut(supplier.identifier),
      contactName: canSeeFullData
        ? supplier.contactName ?? ''
        : restrictedValue(),
      phone: canSeeFullData
        ? supplier.phone ?? ''
        : restrictedValue(),
      email: canSeeFullData
        ? supplier.email ?? ''
        : restrictedValue(),
      lastPurchase: supplier.lastPurchase,
      totalPurchases: supplier.totalPurchases,
      isActive: supplier.isActive,
      isRestricted: !canSeeFullData,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    };
  }
}
