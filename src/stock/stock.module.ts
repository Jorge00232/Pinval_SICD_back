import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';

@Module({
  imports: [ProductsModule],
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
