import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  canSeeSensitiveData,
  maskRut,
  restrictedValue,
} from '../common/mask-sensitive-data';
import type {
  CreateCustomerBody,
  UpdateCustomerBody,
} from './customers.controller';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeOptionalText(value: unknown) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeCustomerType(value: unknown) {
  const text = normalizeText(value).toUpperCase();

  if (text === 'B2C') {
    return 'B2C';
  }

  if (text === 'B2B') {
    return 'B2B';
  }

  throw new BadRequestException('El tipo de cliente debe ser B2B o B2C.');
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(role?: string | null) {
    const customers = await this.prisma.customer.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return customers.map((customer) => this.toResponse(customer, role));
  }

  async create(body: CreateCustomerBody) {
    const name = normalizeText(body.name);

    if (!name) {
      throw new BadRequestException('El nombre del cliente es obligatorio.');
    }

    const customerType = normalizeCustomerType(body.customerType ?? 'B2B');

    const customer = await this.prisma.customer.create({
      data: {
        name,
        contact: normalizeOptionalText(body.contact),
        identifier: normalizeOptionalText(body.identifier),
        customerType,
        lastPurchase: 'Sin compras',
        purchases: 0,
        isActive: true,
      },
    });

    return this.toResponse(customer, 'ADMIN');
  }

  async update(id: string, body: UpdateCustomerBody) {
    const cleanId = normalizeText(id);

    if (!cleanId) {
      throw new BadRequestException('El id del cliente es obligatorio.');
    }

    const currentCustomer = await this.prisma.customer.findUnique({
      where: {
        id: cleanId,
      },
    });

    if (!currentCustomer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const data: {
      name?: string;
      contact?: string | null;
      identifier?: string | null;
      customerType?: string;
      isActive?: boolean;
    } = {};

    if (body.name !== undefined) {
      const name = normalizeText(body.name);

      if (!name) {
        throw new BadRequestException('El nombre del cliente es obligatorio.');
      }

      data.name = name;
    }

    if (body.contact !== undefined) {
      data.contact = normalizeOptionalText(body.contact);
    }

    if (body.identifier !== undefined) {
      data.identifier = normalizeOptionalText(body.identifier);
    }

    if (body.customerType !== undefined) {
      data.customerType = normalizeCustomerType(body.customerType);
    }

    if (body.isActive !== undefined) {
      data.isActive = Boolean(body.isActive);
    }

    const updatedCustomer = await this.prisma.customer.update({
      where: {
        id: cleanId,
      },
      data,
    });

    return this.toResponse(updatedCustomer, 'ADMIN');
  }

  private toResponse(customer: Customer, role?: string | null) {
    const canSeeFullData = canSeeSensitiveData(role);

    return {
      id: customer.id,
      name: customer.name,
      contact: canSeeFullData
        ? customer.contact ?? ''
        : restrictedValue(),
      identifier: canSeeFullData
        ? customer.identifier
        : maskRut(customer.identifier),
      customerType: customer.customerType === 'B2C' ? 'B2C' : 'B2B',
      lastPurchase: customer.lastPurchase,
      purchases: customer.purchases,
      isActive: customer.isActive,
      isRestricted: !canSeeFullData,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }
}
