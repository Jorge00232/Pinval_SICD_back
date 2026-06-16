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
import type { AuthenticatedUser } from '../auth/auth.types';
import { SuppliersService } from './suppliers.service';

export type CreateSupplierBody = {
  name?: string;
  identifier?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type UpdateSupplierBody = Partial<CreateSupplierBody> & {
  isActive?: boolean;
};

type AuthRequest = Request & { user?: AuthenticatedUser };

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @Roles('ADMIN', 'STOCK', 'VIEWER')
  findAll(@Req() request: AuthRequest) {
    return this.suppliersService.findAll(request.user?.role);
  }

  @Post()
  @Roles('ADMIN', 'STOCK')
  create(@Body() body: CreateSupplierBody) {
    return this.suppliersService.create(body);
  }

  @Patch(':id')
  @Roles('ADMIN', 'STOCK')
  update(@Param('id') id: string, @Body() body: UpdateSupplierBody) {
    return this.suppliersService.update(id, body);
  }
}
