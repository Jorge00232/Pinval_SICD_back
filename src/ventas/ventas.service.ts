import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VentasService {
  constructor(private prisma: PrismaService) { }

  findAll() {
    return this.prisma.ventas.findMany();
  }
}
