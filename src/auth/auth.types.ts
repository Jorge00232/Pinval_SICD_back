export type UserRole = 'ADMIN' | 'STOCK' | 'VIEWER';

export type AuthenticatedUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
};

export type JwtPayload = {
  sub: string;
  username: string;
  name: string;
  role: UserRole;
};
