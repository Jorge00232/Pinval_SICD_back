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

  async create(body: CreateSupplierBody) {
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

    return this.toResponse(supplier, 'ADMIN');
  }

  async update(id: string, body: UpdateSupplierBody) {
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

    return this.toResponse(updatedSupplier, 'ADMIN');
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
