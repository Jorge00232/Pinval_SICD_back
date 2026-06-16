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
import { PurchasesService } from './purchases.service';

export type CreatePurchaseBody = {
  date?: string;
  supplierName?: string;
  documentNumber?: string;
  items?: Array<{
    codigo?: string;
    quantity?: number;
  }>;
};

type AuthRequest = Request & { user?: AuthenticatedUser };

@Controller('purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get()
  @Roles('ADMIN', 'STOCK', 'VIEWER')
  findAll() {
    return this.purchasesService.findAll();
  }

  @Post()
  @Roles('ADMIN', 'STOCK')
  create(@Body() body: CreatePurchaseBody, @Req() request: AuthRequest) {
    return this.purchasesService.create(body, request.user);
  }
}
