import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type UserRole = 'ADMIN' | 'STOCK' | 'VIEWER';

type LoginInput = {
  username?: string;
  password?: string;
};

type AuthUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  password: string;
};

const users: AuthUser[] = [
  {
    id: '1',
    username: 'admin',
    name: 'Administrador SICD',
    role: 'ADMIN',
    password: 'admin123',
  },
  {
    id: '2',
    username: 'inventario',
    name: 'Encargado de inventario',
    role: 'STOCK',
    password: 'stock123',
  },
  {
    id: '3',
    username: 'consulta',
    name: 'Usuario de consulta',
    role: 'VIEWER',
    password: 'consulta123',
  },
];

@Injectable()
export class AuthService {
  login(credentials: LoginInput) {
    const username = credentials.username?.trim().toLowerCase();
    const password = credentials.password ?? '';

    const user = users.find(
      (item) => item.username === username && item.password === password,
    );

    if (!user) {
      throw new UnauthorizedException('Usuario o contrasena incorrectos.');
    }

    return {
      accessToken: randomUUID(),
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
    };
  }
}
