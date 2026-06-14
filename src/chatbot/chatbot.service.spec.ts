import { BadRequestException } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import type { ProductsService, ProductResponse } from '../products/products.service';
import type { AiIntentService } from './ai-intent.service';

const products: ProductResponse[] = [
  {
    codigo: '000001',
    descrip: 'PRODUCTO DISPONIBLE',
    displayName: 'Producto Disponible',
    searchName: 'producto disponible',
    familia: 'NO TIENE',
    stock: 20,
    stockOriginal: 20,
    dataIssue: null,
    prcosto: 100,
    prventa: 150,
    minStock: 5,
    fecha: null,
  },
  {
    codigo: '000002',
    descrip: 'PRODUCTO BAJO',
    displayName: 'Producto Bajo',
    searchName: 'producto bajo',
    familia: 'NO TIENE',
    stock: 3,
    stockOriginal: 3,
    dataIssue: null,
    prcosto: 100,
    prventa: 150,
    minStock: 5,
    fecha: null,
  },
  {
    codigo: '000003',
    descrip: 'PRODUCTO SIN STOCK',
    displayName: 'Producto Sin Stock',
    searchName: 'producto sin stock',
    familia: 'NO TIENE',
    stock: 0,
    stockOriginal: 0,
    dataIssue: null,
    prcosto: 100,
    prventa: 150,
    minStock: 5,
    fecha: null,
  },
  {
    codigo: '000004',
    descrip: 'PRODUCTO NEGATIVO',
    displayName: 'Producto Negativo',
    searchName: 'producto negativo',
    familia: 'NO TIENE',
    stock: 0,
    stockOriginal: -4,
    dataIssue: 'STOCK_NEGATIVO',
    prcosto: 100,
    prventa: 150,
    minStock: 5,
    fecha: null,
  },
];

describe('ChatbotService', () => {
  const productsService = {
    findAll: jest.fn().mockResolvedValue(products),
  } as unknown as ProductsService;

  const prisma = {
    chatbotAudit: {
      create: jest.fn().mockResolvedValue({}),
    },
  } as any;

  const aiIntentService = {
    classify: jest.fn().mockResolvedValue(null),
  } as unknown as AiIntentService;

  const service = new ChatbotService(productsService, prisma, aiIntentService);

  beforeEach(() => {
    jest.clearAllMocks();
    productsService.findAll = jest.fn().mockResolvedValue(products);
    aiIntentService.classify = jest.fn().mockResolvedValue(null) as any;
  });

  it('rejects empty messages', async () => {
    await expect(service.answerMessage('')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns an inventory summary', async () => {
    const response = await service.answerMessage('resumen de inventario');

    expect(response.type).toBe('INVENTORY_SUMMARY');
    expect(response.summary).toEqual({
      totalProducts: 4,
      totalUnits: 23,
      availableProducts: 1,
      lowStockProducts: 1,
      outOfStockProducts: 1,
      adjustmentProducts: 1,
    });
  });

  it('does not mix negative stock adjustments with out-of-stock products', async () => {
    const response = await service.answerMessage('productos sin stock');

    expect(response.type).toBe('PRODUCT_LIST');
    expect(response.totalResults).toBe(1);
    expect(response.products?.[0].codigo).toBe('000003');
  });

  it('returns products with the lowest valid stock first', async () => {
    const response = await service.answerMessage(
      'cuales son los productos con menos stock',
    );

    expect(response.type).toBe('PRODUCT_LIST');
    expect(response.products?.map((product) => product.codigo)).toEqual([
      '000003',
      '000002',
      '000001',
    ]);
    expect(
      response.products?.some((product) => product.codigo === '000004'),
    ).toBe(false);
  });

  it('returns products with the highest valid stock first', async () => {
    const response = await service.answerMessage('productos con mayor stock');

    expect(response.type).toBe('PRODUCT_LIST');
    expect(response.products?.map((product) => product.codigo)).toEqual([
      '000001',
      '000002',
      '000003',
    ]);
  });

  it('sanitizes personal data before recording an audit', async () => {
    await service.recordAudit(
      'consulta para 12.345.678-5 y persona@ejemplo.cl',
      {
        id: '1',
        username: 'admin',
        name: 'Administrador SICD',
        role: 'ADMIN',
      },
      'PRODUCT_LIST',
    );

    expect(prisma.chatbotAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        query: 'consulta para [RUT OCULTO] y [CORREO OCULTO]',
      }),
    });
  });

  it('uses an allowed AI intent when local phrases do not match', async () => {
    (aiIntentService.classify as jest.Mock).mockResolvedValueOnce({
      intent: 'LOW_STOCK',
    });

    const response = await service.answerMessage(
      'que articulos estan por acabarse',
    );

    expect(response.type).toBe('PRODUCT_LIST');
    expect(response.products?.[0].codigo).toBe('000002');
  });
});