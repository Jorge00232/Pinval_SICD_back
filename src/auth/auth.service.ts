import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import * as speakeasy from 'speakeasy';
import QRCode from 'qrcode';

export type UserRole = 'ADMIN' | 'STOCK' | 'VIEWER';

type LoginInput = {
  username?: string;
  password?: string;
};

type GoogleLoginInput = {
  idToken?: string;
};

type TwoFactorSetupInput = {
  challengeId?: string;
};

type TwoFactorVerifyInput = {
  challengeId?: string;
  token?: string;
};

type AuthUser = {
  id: string;
  username: string;
  email: string;
  name: string;
  role: UserRole;
  password: string;
  twoFactorSecret: string;
};

type PublicUser = {
  id: string;
  username: string;
  email: string;
  name: string;
  role: UserRole;
};

type PendingChallenge = {
  id: string;
  userId: string;
  expiresAt: number;
};

const users: AuthUser[] = [
  {
    id: '1',
    username: 'admin',
    email: 'jorg.manriquez@duocuc.cl',
    name: 'Administrador SICD',
    role: 'ADMIN',
    password: 'admin123',
    twoFactorSecret: 'JBSWY3DPEHPK3PXP',
  },
  {
    id: '2',
    username: 'inventario',
    email: 'stock@pinval.cl',
    name: 'Encargado de inventario',
    role: 'STOCK',
    password: 'stock123',
    twoFactorSecret: 'JBSWY3DPEHPK3PXQ',
  },
  {
    id: '3',
    username: 'consulta',
    email: 'consulta@pinval.cl',
    name: 'Usuario de consulta',
    role: 'VIEWER',
    password: 'consulta123',
    twoFactorSecret: 'JBSWY3DPEHPK3PXR',
  },
];

const pendingChallenges = new Map<string, PendingChallenge>();

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
  );

  login(credentials: LoginInput) {
    const username = credentials.username?.trim().toLowerCase();
    const password = credentials.password ?? '';

    const user = users.find(
      (item) =>
        (item.username === username || item.email.toLowerCase() === username) &&
        item.password === password,
    );

    if (!user) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos.');
    }

    return this.createTwoFactorChallenge(user);
  }

  async googleLogin(input: GoogleLoginInput) {
    const idToken = input.idToken;

    if (!idToken) {
      throw new BadRequestException('Falta el idToken de Google.');
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new BadRequestException(
        'GOOGLE_CLIENT_ID no está configurado en el backend.',
      );
    }

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();

      const email = payload?.email?.toLowerCase();
      const name = payload?.name ?? 'Usuario Google';

      if (!email) {
        throw new UnauthorizedException('La cuenta de Google no tiene email.');
      }

      let user = users.find((item) => item.email.toLowerCase() === email);

      if (!user) {
        const generatedSecret = speakeasy.generateSecret({
          name: `Pinval SICD (${email})`,
          issuer: 'Pinval SICD',
          length: 20,
        });

        user = {
          id: randomUUID(),
          username: email.split('@')[0],
          email,
          name,
          role: 'VIEWER',
          password: '',
          twoFactorSecret: generatedSecret.base32,
        };

        users.push(user);
      }

      return this.createTwoFactorChallenge(user);
    } catch {
      throw new UnauthorizedException('Token de Google no válido.');
    }
  }

  async setupTwoFactor(input: TwoFactorSetupInput) {
    const challengeId = input.challengeId;

    if (!challengeId) {
      throw new BadRequestException('Falta challengeId.');
    }

    const challenge = pendingChallenges.get(challengeId);

    if (!challenge) {
      throw new UnauthorizedException('Desafío 2FA no encontrado.');
    }

    if (Date.now() > challenge.expiresAt) {
      pendingChallenges.delete(challengeId);
      throw new UnauthorizedException('El desafío 2FA expiró.');
    }

    const user = users.find((item) => item.id === challenge.userId);

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    if (!user.twoFactorSecret) {
      const generatedSecret = speakeasy.generateSecret({
        name: `Pinval SICD (${user.email})`,
        issuer: 'Pinval SICD',
        length: 20,
      });

      user.twoFactorSecret = generatedSecret.base32;
    }

    const otpauthUrl = speakeasy.otpauthURL({
      secret: user.twoFactorSecret,
      label: user.email,
      issuer: 'Pinval SICD',
      encoding: 'base32',
    });

    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    return {
      qrDataUrl,
      otpauthUrl,
      secret: user.twoFactorSecret,
    };
  }

  verifyTwoFactor(input: TwoFactorVerifyInput) {
    const challengeId = input.challengeId;
    const token = input.token?.trim();

    if (!challengeId || !token) {
      throw new BadRequestException('Faltan datos de verificación 2FA.');
    }

    const challenge = pendingChallenges.get(challengeId);

    if (!challenge) {
      throw new UnauthorizedException('Desafío 2FA no encontrado.');
    }

    if (Date.now() > challenge.expiresAt) {
      pendingChallenges.delete(challengeId);
      throw new UnauthorizedException('El código 2FA expiró.');
    }

    const user = users.find((item) => item.id === challenge.userId);

    if (!user) {
      pendingChallenges.delete(challengeId);
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (!isValid) {
      throw new UnauthorizedException('Código 2FA incorrecto.');
    }

    pendingChallenges.delete(challengeId);

    return {
      accessToken: randomUUID(),
      user: this.toPublicUser(user),
    };
  }

  private createTwoFactorChallenge(user: AuthUser) {
    const challengeId = randomUUID();

    pendingChallenges.set(challengeId, {
      id: challengeId,
      userId: user.id,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return {
      requires2FA: true,
      challengeId,
      user: this.toPublicUser(user),
    };
  }

  private toPublicUser(user: AuthUser): PublicUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
}