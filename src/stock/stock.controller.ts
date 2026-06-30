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
import { ProductsService } from '../products/products.service';
import type {
  CreateProductBody,
  UpdateProductBody,
} from '../products/products.controller';
import { StockService } from './stock.service';

type AuthRequest = Request & { user?: AuthenticatedUser };

@Controller('stock')
export class StockController {
  constructor(
    private readonly stockService: StockService,
    private readonly productsService: ProductsService,
  ) {}

  @Get()
  findAll() {
    return this.stockService.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STOCK')
  create(@Body() body: CreateProductBody, @Req() request: AuthRequest) {
    return this.productsService.create(body, request.user);
  }

  @Patch(':codigo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STOCK')
  update(
    @Param('codigo') codigo: string,
    @Body() body: UpdateProductBody,
    @Req() request: AuthRequest,
  ) {
    return this.productsService.update(codigo, body, request.user);
  }
}
