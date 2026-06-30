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
import { ProductsService } from './products.service';

export type CreateProductBody = {
  codigo?: string | number;
  descrip?: string;
  displayName?: string | null;
  searchName?: string | null;
  familia?: string | null;
  stock?: number | string;
  prcosto?: number | string;
  prventa?: number | string;
  minStock?: number | string;
  fecha?: string | null;
  ubicacion?: string | null;
  proveedor?: string | null;
  lote?: string | null;
  fechaCaducidad?: string | null;
};

export type UpdateProductBody = Partial<CreateProductBody>;

type AuthRequest = Request & { user?: AuthenticatedUser };

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll() {
    return this.productsService.findAll();
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

  @Get(':codigo/existence-card')
  getExistenceCard(@Param('codigo') codigo: string) {
    return this.productsService.getExistenceCard(codigo);
  }

  @Post('normalize-names')
  normalizeNames() {
    return this.productsService.normalizeExistingProductNames();
  }
}
