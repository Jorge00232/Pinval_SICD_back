import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService();
  });

  it('returns a user session for valid credentials', () => {
    const response = service.login({
      username: 'admin',
      password: 'admin123',
    });

    expect(response.accessToken).toBeDefined();
    expect(response.user).toEqual({
      id: '1',
      username: 'admin',
      name: 'Administrador SICD',
      role: 'ADMIN',
    });
  });

  it('rejects invalid credentials', () => {
    expect(() =>
      service.login({
        username: 'admin',
        password: 'wrong',
      }),
    ).toThrow(UnauthorizedException);
  });
});
