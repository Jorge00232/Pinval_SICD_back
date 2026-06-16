import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SalesService } from './sales.service';

export type CreateSaleBody = {
  date?: string;
  customerName?: string;
  customerType?: 'B2B' | 'B2C';
  customerIdentifier?: string | null;
  documentType?: string;
  documentNumber?: string;
  items?: Array<{
    codigo?: string;
    quantity?: number;
  }>;
};

type AuthRequest = Request & { user?: AuthenticatedUser };

@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  @Roles('ADMIN', 'STOCK', 'VIEWER')
  findAll(@Req() request: AuthRequest) {
    return this.salesService.findAll(request.user?.role);
  }

  @Post()
  @Roles('ADMIN', 'STOCK')
  create(@Body() body: CreateSaleBody, @Req() request: AuthRequest) {
    return this.salesService.create(body, request.user);
  }
}
