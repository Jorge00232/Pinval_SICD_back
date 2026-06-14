import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { InventoryMovementsService } from './inventory-movements.service';

export type CreateInventoryMovementBody = {
  codigo?: string;
  productName?: string;
  type?: 'ENTRADA' | 'SALIDA' | 'AJUSTE' | 'Entrada' | 'Salida' | 'Ajuste';
  quantity?: number;
  unitPrice?: number | null;
  totalPrice?: number | null;
  stockAfter?: number | null;
  reason?: string | null;
  user?: string | null;
  detail?: string | null;
  createdAt?: string | null;
};

@Controller('inventory-movements')
export class InventoryMovementsController {
  constructor(
    private readonly inventoryMovementsService: InventoryMovementsService,
  ) {}

  @Get()
  findAll(@Query('codigo') codigo?: string) {
    return this.inventoryMovementsService.findAll(codigo);
  }

  @Post()
  create(@Body() body: CreateInventoryMovementBody | CreateInventoryMovementBody[]) {
    return this.inventoryMovementsService.create(body);
  }
}