import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { StockModule } from './stock/stock.module';
import { VentasModule } from './ventas/ventas.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { InventoryMovementsModule } from './inventory-movements/inventory-movements.module';
import { SidebarModule } from './sidebar/sidebar.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    ProductsModule,
    StockModule,
    VentasModule,
    ChatbotModule,
    InventoryMovementsModule,
    SidebarModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}