import { Controller, Get, Param, Post } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll() {
    return this.productsService.findAll();
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