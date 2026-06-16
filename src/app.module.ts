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
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchasesModule } from './purchases/purchases.module';
import { SalesModule } from './sales/sales.module';
import { ImportsModule } from './imports/imports.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    StockModule,
    VentasModule,
    ChatbotModule,
    InventoryMovementsModule,
    SidebarModule,
    CustomersModule,
    SuppliersModule,
    PurchasesModule,
    SalesModule,
    ImportsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
