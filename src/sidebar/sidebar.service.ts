import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MIN_STOCK_ALERT = 5;

@Injectable()
export class SidebarService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const [
      totalMovements,
      negativeStockAlerts,
      noStockAlerts,
      minStockAlert,
    ] = await Promise.all([
      this.prisma.inventoryMovement.count(),

      this.prisma.stockValorizado.count({
        where: {
          stock: {
            lt: 0,
          },
        },
      }),

      this.prisma.stockValorizado.count({
        where: {
          OR: [
            { stock: null },
            { stock: 0 },
          ],
        },
      }),

      this.prisma.stockValorizado.count({
        where: {
          stock: {
            gt: 0,
            lte: MIN_STOCK_ALERT,
          },
        },
      }),
    ]);

    const activeAlerts =
      negativeStockAlerts + noStockAlerts + minStockAlert;

    return {
      totalMovements,
      activeAlerts,
      negativeStockAlerts,
      noStockAlerts,
      minStockAlert,
    };
  }
}
