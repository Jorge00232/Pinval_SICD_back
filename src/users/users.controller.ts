import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthenticatedUser, UserRole } from '../auth/auth.types';
import { UsersService } from './users.service';

type CreateUserBody = {
  username?: string;
  email?: string;
  name?: string;
  role?: UserRole;
  password?: string;
  allowGoogle?: boolean;
  isActive?: boolean;
};

type UpdateUserBody = {
  username?: string | null;
  email?: string;
  name?: string;
  role?: UserRole;
  password?: string;
  allowGoogle?: boolean;
  isActive?: boolean;
};

type AuthRequest = Request & { user?: AuthenticatedUser };

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  create(@Body() body: CreateUserBody, @Req() request: AuthRequest) {
    return this.usersService.create(body, request.user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateUserBody,
    @Req() request: AuthRequest,
  ) {
    return this.usersService.update(id, body, request.user);
  }

  @Patch(':id/reset-2fa')
  resetTwoFactor(@Param('id') id: string, @Req() request: AuthRequest) {
    return this.usersService.resetTwoFactor(id, request.user);
  }
}