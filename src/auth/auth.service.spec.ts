import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as speakeasy from 'speakeasy';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService!: Pick<JwtService, 'signAsync'>;

  beforeEach(() => {
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-jwt-token'),
    } as Pick<JwtService, 'signAsync'>;

    service = new AuthService(jwtService as JwtService);
  });

  it('creates a 2FA challenge for valid credentials', async () => {
    const response = await service.login({
      username: 'admin',
      password: 'admin123',
    });

    expect(response.requires2FA).toBe(true);
    expect(response.challengeId).toBeDefined();
    expect(response.user).toEqual({
      id: '1',
      username: 'admin',
      email: 'jorg.manriquez@duocuc.cl',
      name: 'Administrador SICD',
      role: 'ADMIN',
    });
  });

  it('returns a JWT after valid 2FA verification', async () => {
    const loginResponse = await service.login({
      username: 'admin',
      password: 'admin123',
    });

    const token = speakeasy.totp({
      secret: 'JBSWY3DPEHPK3PXP',
      encoding: 'base32',
    });

    const response = await service.verifyTwoFactor({
      challengeId: loginResponse.challengeId,
      token,
    });

    expect(response.accessToken).toBe('signed-jwt-token');
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: '1',
      username: 'admin',
      email: 'jorg.manriquez@duocuc.cl',
      name: 'Administrador SICD',
      role: 'ADMIN',
    });
  });

  it('keeps conarce as an admin user', async () => {
    const response = await service.login({
      username: 'conarce',
      password: 'ADMIN123',
    });

    expect(response.requires2FA).toBe(true);
    expect(response.user).toEqual({
      id: '4',
      username: 'conarce',
      email: 'constanza.arce123@gmail.com',
      name: 'Administrador SICD',
      role: 'ADMIN',
    });
  });

  it('rejects invalid credentials', async () => {
    await expect(
      service.login({
        username: 'admin',
        password: 'wrong',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
