import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import type { UserRole } from '../auth/auth.types';

type CreateUserInput = {
  username?: string;
  email?: string;
  name?: string;
  role?: UserRole;
  password?: string;
  allowGoogle?: boolean;
  isActive?: boolean;
};

type UpdateUserInput = {
  username?: string | null;
  email?: string;
  name?: string;
  role?: UserRole;
  password?: string;
  allowGoogle?: boolean;
  isActive?: boolean;
};

type DbUser = {
  id: string;
  username: string | null;
  email: string;
  name: string;
  role: string;
  passwordHash: string | null;
  twoFactorSecret: string | null;
  isActive: boolean;
  allowGoogle: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type SafeUser = {
  id: string;
  username: string | null;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  allowGoogle: boolean;
  hasPassword: boolean;
  hasTwoFactor: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const ALLOWED_ROLES: UserRole[] = ['ADMIN', 'STOCK', 'VIEWER'];

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      orderBy: [
        {
          role: 'asc',
        },
        {
          name: 'asc',
        },
      ],
    });

    return users.map((user) => this.toSafeUser(user));
  }

  async create(input: CreateUserInput) {
    const email = this.normalizeEmail(input.email);
    const username = this.normalizeOptionalText(input.username);
    const name = this.normalizeRequiredText(input.name, 'El nombre es obligatorio.');
    const role = this.normalizeRole(input.role);
    const allowGoogle = input.allowGoogle ?? true;
    const isActive = input.isActive ?? true;
    const passwordHash = await this.hashPasswordIfPresent(input.password);

    await this.ensureEmailIsAvailable(email);

    if (username) {
      await this.ensureUsernameIsAvailable(username);
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          username,
          email,
          name,
          role,
          passwordHash,
          allowGoogle,
          isActive,
          twoFactorSecret: null,
        },
      });

      return this.toSafeUser(user);
    } catch (error) {
      this.handleUniqueConstraintError(error);
      throw error;
    }
  }

  async update(id: string, input: UpdateUserInput) {
    const currentUser = await this.findUserByIdOrThrow(id);

    const data: {
      username?: string | null;
      email?: string;
      name?: string;
      role?: UserRole;
      passwordHash?: string | null;
      allowGoogle?: boolean;
      isActive?: boolean;
    } = {};

    if (input.username !== undefined) {
      const username = this.normalizeOptionalText(input.username);

      if (username && username !== currentUser.username) {
        await this.ensureUsernameIsAvailable(username, currentUser.id);
      }

      data.username = username;
    }

    if (input.email !== undefined) {
      const email = this.normalizeEmail(input.email);

      if (email !== currentUser.email) {
        await this.ensureEmailIsAvailable(email, currentUser.id);
      }

      data.email = email;
    }

    if (input.name !== undefined) {
      data.name = this.normalizeRequiredText(input.name, 'El nombre es obligatorio.');
    }

    if (input.role !== undefined) {
      data.role = this.normalizeRole(input.role);
    }

    if (input.password !== undefined) {
      data.passwordHash = await this.hashPasswordIfPresent(input.password);
    }

    if (input.allowGoogle !== undefined) {
      data.allowGoogle = Boolean(input.allowGoogle);
    }

    if (input.isActive !== undefined) {
      data.isActive = Boolean(input.isActive);
    }

    try {
      const updatedUser = await this.prisma.user.update({
        where: {
          id: currentUser.id,
        },
        data,
      });

      return this.toSafeUser(updatedUser);
    } catch (error) {
      this.handleUniqueConstraintError(error);
      throw error;
    }
  }

  async resetTwoFactor(id: string) {
    const currentUser = await this.findUserByIdOrThrow(id);

    const updatedUser = await this.prisma.user.update({
      where: {
        id: currentUser.id,
      },
      data: {
        twoFactorSecret: null,
      },
    });

    return this.toSafeUser(updatedUser);
  }

  private async findUserByIdOrThrow(id: string): Promise<DbUser> {
    const cleanId = id.trim();

    if (!cleanId) {
      throw new BadRequestException('El id de usuario es obligatorio.');
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: cleanId,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    return user;
  }

  private async ensureEmailIsAvailable(email: string, currentUserId?: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (existingUser && existingUser.id !== currentUserId) {
      throw new ConflictException('Ya existe un usuario con ese correo.');
    }
  }

  private async ensureUsernameIsAvailable(username: string, currentUserId?: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        username,
      },
    });

    if (existingUser && existingUser.id !== currentUserId) {
      throw new ConflictException('Ya existe un usuario con ese nombre de usuario.');
    }
  }

  private normalizeEmail(value?: string) {
    const email = value?.trim().toLowerCase() ?? '';

    if (!email) {
      throw new BadRequestException('El correo es obligatorio.');
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      throw new BadRequestException('El correo no tiene un formato válido.');
    }

    return email;
  }

  private normalizeOptionalText(value?: string | null) {
    const cleanValue = value?.trim().toLowerCase() ?? '';

    return cleanValue || null;
  }

  private normalizeRequiredText(value: unknown, message: string) {
    if (typeof value !== 'string') {
      throw new BadRequestException(message);
    }

    const cleanValue = value.trim();

    if (!cleanValue) {
      throw new BadRequestException(message);
    }

    return cleanValue;
  }

  private normalizeRole(role?: UserRole) {
    if (!role || !ALLOWED_ROLES.includes(role)) {
      throw new BadRequestException('El rol debe ser ADMIN, STOCK o VIEWER.');
    }

    return role;
  }

  private async hashPasswordIfPresent(password?: string) {
    const cleanPassword = password?.trim() ?? '';

    if (!cleanPassword) {
      return null;
    }

    if (cleanPassword.length < 6) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 6 caracteres.',
      );
    }

    return bcrypt.hash(cleanPassword, 10);
  }

  private toSafeUser(user: DbUser): SafeUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: this.toUserRole(user.role),
      isActive: user.isActive,
      allowGoogle: user.allowGoogle,
      hasPassword: Boolean(user.passwordHash),
      hasTwoFactor: Boolean(user.twoFactorSecret),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private toUserRole(role: string): UserRole {
    if (role === 'ADMIN' || role === 'STOCK' || role === 'VIEWER') {
      return role;
    }

    throw new BadRequestException('El usuario tiene un rol no válido.');
  }

  private handleUniqueConstraintError(error: unknown): never | void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'No se pudo guardar el usuario porque el correo o username ya existe.',
      );
    }
  }
}