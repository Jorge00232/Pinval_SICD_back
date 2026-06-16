import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import QRCode from 'qrcode';
import * as speakeasy from 'speakeasy';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import type { UserRole } from './auth.types';

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

type AuthDbUser = {
  id: string;
  username: string | null;
  email: string;
  name: string;
  role: string;
  passwordHash: string | null;
  twoFactorSecret: string | null;
  isActive: boolean;
  allowGoogle: boolean;
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

const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const pendingChallenges = new Map<string, PendingChallenge>();

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
  );

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async login(credentials: LoginInput) {
    const usernameOrEmail = this.normalizeText(credentials.username);
    const password = credentials.password ?? '';

    if (!usernameOrEmail || !password) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos.');
    }

    const user = await this.findActiveUserByUsernameOrEmail(usernameOrEmail);

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
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

    let email = '';

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();

      email = this.normalizeText(payload?.email);

      if (!email) {
        throw new UnauthorizedException('La cuenta de Google no tiene email.');
      }

      if (payload?.email_verified !== true) {
        throw new UnauthorizedException(
          'La cuenta de Google no tiene el correo verificado.',
        );
      }
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      throw new UnauthorizedException('Token de Google no válido.');
    }

    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user || user.isActive === false || user.allowGoogle === false) {
      throw new UnauthorizedException(
        'Tu cuenta Google no está autorizada para acceder a SICD.',
      );
    }

    return this.createTwoFactorChallenge(user);
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

    const user = await this.findActiveUserById(challenge.userId);

    if (!user) {
      pendingChallenges.delete(challengeId);
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    const twoFactorSecret = await this.ensureTwoFactorSecret(user);

    const otpauthUrl = speakeasy.otpauthURL({
      secret: twoFactorSecret,
      label: user.email,
      issuer: 'Pinval SICD',
      encoding: 'base32',
    });

    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    return {
      qrDataUrl,
      otpauthUrl,
      secret: twoFactorSecret,
    };
  }

  async verifyTwoFactor(input: TwoFactorVerifyInput) {
    const challengeId = input.challengeId;
    const token = input.token?.trim();

    if (!challengeId || !token) {
      throw new BadRequestException('Faltan datos de verificación 2FA.');
    }

    if (!/^\d{6}$/.test(token)) {
      throw new BadRequestException('El código 2FA debe tener 6 dígitos.');
    }

    const challenge = pendingChallenges.get(challengeId);

    if (!challenge) {
      throw new UnauthorizedException('Desafío 2FA no encontrado.');
    }

    if (Date.now() > challenge.expiresAt) {
      pendingChallenges.delete(challengeId);
      throw new UnauthorizedException('El código 2FA expiró.');
    }

    const user = await this.findActiveUserById(challenge.userId);

    if (!user) {
      pendingChallenges.delete(challengeId);
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    const twoFactorSecret = user.twoFactorSecret;

    if (!twoFactorSecret) {
      pendingChallenges.delete(challengeId);
      throw new UnauthorizedException(
        'El usuario no tiene 2FA configurado.',
      );
    }

    const isValid = speakeasy.totp.verify({
      secret: twoFactorSecret,
      encoding: 'base32',
      token,
      window: 2,
    });

    if (!isValid) {
      throw new UnauthorizedException('Código 2FA incorrecto.');
    }

    pendingChallenges.delete(challengeId);

    return {
      accessToken: await this.signAccessToken(user),
      user: this.toPublicUser(user),
    };
  }

  private async ensureTwoFactorSecret(user: AuthDbUser) {
    if (user.twoFactorSecret) {
      return user.twoFactorSecret;
    }

    const generatedSecret = speakeasy.generateSecret({
      name: `Pinval SICD (${user.email})`,
      issuer: 'Pinval SICD',
      length: 20,
    });

    await this.prisma.user.updateMany({
      where: {
        id: user.id,
        twoFactorSecret: null,
        isActive: true,
      },
      data: {
        twoFactorSecret: generatedSecret.base32,
      },
    });

    const updatedUser = await this.findActiveUserById(user.id);

    if (!updatedUser?.twoFactorSecret) {
      pendingChallenges.forEach((challenge, challengeId) => {
        if (challenge.userId === user.id) {
          pendingChallenges.delete(challengeId);
        }
      });

      throw new BadRequestException('No se pudo configurar 2FA.');
    }

    return updatedUser.twoFactorSecret;
  }

  private async findActiveUserByUsernameOrEmail(
    usernameOrEmail: string,
  ): Promise<AuthDbUser | null> {
    return this.prisma.user.findFirst({
      where: {
        isActive: true,
        OR: [
          {
            username: usernameOrEmail,
          },
          {
            email: usernameOrEmail,
          },
        ],
      },
    });
  }

  private async findActiveUserById(
    userId: string,
  ): Promise<AuthDbUser | null> {
    return this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
      },
    });
  }

  private createTwoFactorChallenge(user: AuthDbUser) {
    const challengeId = randomUUID();

    pendingChallenges.set(challengeId, {
      id: challengeId,
      userId: user.id,
      expiresAt: Date.now() + TWO_FACTOR_CHALLENGE_TTL_MS,
    });

    return {
      requires2FA: true,
      challengeId,
      user: this.toPublicUser(user),
    };
  }

  private signAccessToken(user: AuthDbUser) {
    const role = this.toUserRole(user.role);

    return this.jwtService.signAsync({
      sub: user.id,
      username: this.getUsername(user),
      email: user.email,
      name: user.name,
      role,
    });
  }

  private toPublicUser(user: AuthDbUser): PublicUser {
    return {
      id: user.id,
      username: this.getUsername(user),
      email: user.email,
      name: user.name,
      role: this.toUserRole(user.role),
    };
  }

  private toUserRole(role: string): UserRole {
    if (role === 'ADMIN' || role === 'STOCK' || role === 'VIEWER') {
      return role;
    }

    throw new UnauthorizedException('El usuario tiene un rol no válido.');
  }

  private getUsername(user: AuthDbUser) {
    const username = user.username?.trim();

    if (username) {
      return username;
    }

    return user.email.split('@')[0] || user.email;
  }

  private normalizeText(value?: string | null) {
    return value?.trim().toLowerCase() ?? '';
  }
}
