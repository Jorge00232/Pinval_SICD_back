import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { UserRole } from '../auth/auth.types';
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
  create(@Body() body: CreateUserBody) {
    return this.usersService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateUserBody) {
    return this.usersService.update(id, body);
  }

  @Patch(':id/reset-2fa')
  resetTwoFactor(@Param('id') id: string) {
    return this.usersService.resetTwoFactor(id);
  }
}