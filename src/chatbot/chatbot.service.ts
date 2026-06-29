import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ProductsService,
  type ProductResponse,
} from '../products/products.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { AiIntentService, type AiIntent } from './ai-intent.service';
import {
  type ChatbotProduct,
  type ChatbotProductStatus,
  type ChatbotResponse,
} from './chatbot.types';

const MAX_MESSAGE_LENGTH = 200;
const MAX_LIST_RESULTS = 10;

type LocalIntent =
  | { intent: 'OUT_OF_SCOPE' }
  | { intent: 'INVENTORY_SUMMARY' }
  | { intent: 'ADJUSTMENTS' }
  | { intent: 'OUT_OF_STOCK' }
  | { intent: 'LOW_STOCK' }
  | { intent: 'LOWEST_STOCK' }
  | { intent: 'HIGHEST_STOCK' }
  | { intent: 'PRODUCT_STOCK'; searchTerm: string }
  | {
      intent: 'PRODUCT_SCOPED_RANKING';
      searchTerm: string;
      direction: 'LOWEST' | 'HIGHEST';
    }
  | { intent: 'PRODUCT_SEARCH'; searchTerm: string }
  | { intent: 'PRODUCT_INFORMATION'; searchTerm: string }
  | { intent: 'UNKNOWN' };

function normalizeText(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[?.,;:!¿¡'"`´<>/\\()[\]{}|@#$%^&*_+=~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalizeKnownTypos(normalized);
}

function normalizeKnownTypos(value: string) {
  return value
    .replace(/\bcunan?tos\b/g, 'cuantos')
    .replace(/\bcuna?ntos\b/g, 'cuantos')
    .replace(/\bcuantoss+\b/g, 'cuantos')
    .replace(/\bcunantas\b/g, 'cuantas')
    .replace(/\bcuna?ntas\b/g, 'cuantas')
    .replace(/\bproductoos\b/g, 'productos')
    .replace(/\bprodcutos\b/g, 'productos')
    .replace(/\bprodcuto\b/g, 'producto')
    .replace(/\bpruductos\b/g, 'productos')
    .replace(/\bpruducto\b/g, 'producto')
    .replace(/\bstok\b/g, 'stock')
    .replace(/\bstcok\b/g, 'stock')
    .replace(/\bstockk\b/g, 'stock')
    .replace(/\bexsitencia\b/g, 'existencia')
    .replace(/\bexsitencias\b/g, 'existencias')
    .replace(/\bminmo\b/g, 'minimo')
    .replace(/\bminimmo\b/g, 'minimo')
    .replace(/\bminimun\b/g, 'minimo')
    .replace(/\bbjao\b/g, 'bajo')
    .replace(/\bbajos\b/g, 'bajo')
    .replace(/\bestan\b/g, 'estan')
    .replace(/\bestán\b/g, 'estan')
    .replace(/\bcu[aá]l\b/g, 'cual')
    .replace(/\bm[aá]s\b/g, 'mas')
    .replace(/\scodigo\s/g, ' codigo ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getProductStatus(product: ProductResponse): ChatbotProductStatus {
  if (product.dataIssue === 'STOCK_NEGATIVO') {
    return 'REQUIERE_AJUSTE';
  }

  if (product.stock === 0) {
    return 'SIN_STOCK';
  }

  if (product.stock <= product.minStock) {
    return 'BAJO_MINIMO';
  }

  return 'DISPONIBLE';
}

function toChatbotProduct(product: ProductResponse): ChatbotProduct {
  return {
    codigo: product.codigo,
    descrip: product.descrip,
    stock: product.stock,
    minStock: product.minStock,
    status: getProductStatus(product),
  };
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly productsService: ProductsService,
    private readonly prisma: PrismaService,
    private readonly aiIntentService: AiIntentService,
  ) {}

  getStatus() {
    return {
      status: 'available',
      mode: 'inventory-assistant',
      capabilities: [
        'saludar y orientar al usuario',
        'buscar producto por código o nombre',
        'consultar stock de un producto',
        'explicar conceptos básicos de productos de inventario',
        'productos bajo mínimo',
        'productos sin stock',
        'productos con menor stock',
        'productos con mayor stock',
        'productos que requieren ajuste',
        'resumen de inventario',
      ],
    };
  }

  async answerMessage(rawMessage: unknown): Promise<ChatbotResponse> {
    const message = this.validateMessage(rawMessage);
    const normalizedMessage = normalizeText(message);

    if (this.isGreetingIntent(normalizedMessage)) {
      return {
        type: 'GENERAL',
        answer:
          'Hola. Soy el Asistente SICD. Puedo ayudarte con consultas de inventario, stock, productos, bajo mínimo, productos sin stock, ajustes, resumen y conceptos básicos de productos como cloro o detergente.',
      };
    }

    if (this.isHelpIntent(normalizedMessage)) {
      return {
        type: 'GENERAL',
        answer:
          'Puedes preguntarme cosas como: "resumen de inventario", "productos bajo mínimo", "productos sin stock", "productos con menos stock", "cuántos cloros hay en stock", "qué es el cloro" o "para qué sirve el detergente".',
      };
    }

    const localIntent = this.classifyLocalIntent(normalizedMessage);

    if (localIntent.intent === 'OUT_OF_SCOPE') {
      return this.buildOutOfScopeResponse();
    }

    const products = await this.productsService.findAll();

    switch (localIntent.intent) {
      case 'INVENTORY_SUMMARY':
        return this.buildInventorySummary(products);

      case 'ADJUSTMENTS':
        return this.buildProductList(
          products.filter((product) => product.dataIssue === 'STOCK_NEGATIVO'),
          { singular: 'requiere ajuste', plural: 'requieren ajuste' },
        );

      case 'OUT_OF_STOCK':
        return this.buildProductList(
          products.filter(
            (product) =>
              product.dataIssue !== 'STOCK_NEGATIVO' && product.stock === 0,
          ),
          { singular: 'está sin stock', plural: 'están sin stock' },
        );

      case 'LOW_STOCK':
        return this.buildProductList(
          products.filter(
            (product) =>
              product.dataIssue !== 'STOCK_NEGATIVO' &&
              product.stock > 0 &&
              product.stock <= product.minStock,
          ),
          { singular: 'está bajo el mínimo', plural: 'están bajo el mínimo' },
        );

      case 'LOWEST_STOCK':
        return this.buildStockRanking(products, 'LOWEST');

      case 'HIGHEST_STOCK':
        return this.buildStockRanking(products, 'HIGHEST');

      case 'PRODUCT_STOCK':
        return this.searchProduct(products, message, localIntent.searchTerm);

      case 'PRODUCT_SEARCH':
        return this.searchProduct(products, message, localIntent.searchTerm);

      case 'PRODUCT_INFORMATION':
        return this.buildProductInformationResponse(
          products,
          message,
          localIntent.searchTerm,
        );

      case 'PRODUCT_SCOPED_RANKING':
        return this.buildProductScopedStockRanking(
          products,
          localIntent.searchTerm,
          localIntent.direction,
        );

      case 'UNKNOWN':
        break;
    }

    const aiIntent = await this.aiIntentService.classify(message);
    const aiInventoryResponse = this.resolveAiIntent(aiIntent, products, message);

    if (aiInventoryResponse) {
      return aiInventoryResponse;
    }

    return {
      type: 'GENERAL',
      answer:
        'No entendí la consulta de inventario. Intenta preguntar por stock, código, nombre de producto, bajo mínimo, sin stock o resumen de inventario.',
    };
  }

  async recordAudit(
    rawMessage: unknown,
    user: AuthenticatedUser,
    responseType: ChatbotResponse['type'],
  ) {
    if (typeof rawMessage !== 'string') {
      return;
    }

    try {
      await (this.prisma as any).chatbotAudit.create({
        data: {
          userId: user.id,
          username: user.username,
          role: user.role,
          query: this.sanitizeAuditQuery(rawMessage),
          responseType,
        },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar auditoría del chatbot. ${
          error instanceof Error ? error.message : ''
        }`,
      );
    }
  }

  private validateMessage(rawMessage: unknown) {
    if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
      throw new BadRequestException('El campo message es obligatorio.');
    }

    const message = rawMessage.trim();

    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres.`,
      );
    }

    return message;
  }

  private sanitizeAuditQuery(message: string) {
    return message
      .trim()
      .slice(0, MAX_MESSAGE_LENGTH)
      .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[RUT OCULTO]')
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        '[CORREO OCULTO]',
      );
  }

  private classifyLocalIntent(message: string): LocalIntent {
    if (this.isOutOfBusinessScopeMessage(message)) {
      return { intent: 'OUT_OF_SCOPE' };
    }

    const productInformationTerm = this.extractProductInformationTerm(message);

    if (productInformationTerm) {
      return {
        intent: 'PRODUCT_INFORMATION',
        searchTerm: productInformationTerm,
      };
    }

    if (!this.isInventoryDomainMessage(message)) {
      return { intent: 'OUT_OF_SCOPE' };
    }

    const scopedRanking = this.extractProductScopedRanking(message);

    if (scopedRanking) {
      return {
        intent: 'PRODUCT_SCOPED_RANKING',
        searchTerm: scopedRanking.searchTerm,
        direction: scopedRanking.direction,
      };
    }

    if (this.isInventorySummaryIntent(message)) {
      return { intent: 'INVENTORY_SUMMARY' };
    }

    if (this.isAdjustmentIntent(message)) {
      return { intent: 'ADJUSTMENTS' };
    }

    if (this.isOutOfStockIntent(message)) {
      return { intent: 'OUT_OF_STOCK' };
    }

    if (this.isLowStockIntent(message)) {
      return { intent: 'LOW_STOCK' };
    }

    if (this.isLowestStockIntent(message)) {
      return { intent: 'LOWEST_STOCK' };
    }

    if (this.isHighestStockIntent(message)) {
      return { intent: 'HIGHEST_STOCK' };
    }

    const stockSearchTerm = this.extractProductStockSearchTerm(message);

    if (stockSearchTerm) {
      return {
        intent: 'PRODUCT_STOCK',
        searchTerm: stockSearchTerm,
      };
    }

    const productSearchTerm = this.extractExplicitProductSearchTerm(message);

    if (productSearchTerm) {
      return {
        intent: 'PRODUCT_SEARCH',
        searchTerm: productSearchTerm,
      };
    }

    return { intent: 'UNKNOWN' };
  }

  private buildOutOfScopeResponse(): ChatbotResponse {
    return {
      type: 'GENERAL',
      answer:
        'Lo siento, no puedo responder eso. Puedo ayudarte con consultas relacionadas al inventario SICD: stock, productos, bajo mínimo, productos sin stock, ajustes, resumen de inventario y conceptos básicos de productos registrados o usados en inventario.',
    };
  }

  private isGreetingIntent(message: string) {
    return /^(hola|holaa|holaaa|buenas|buenos dias|buenas tardes|buenas noches|hello|hi|hey)$/.test(
      message,
    );
  }

  private isHelpIntent(message: string) {
    return (
      message.includes('ayuda') ||
      message.includes('que puedes hacer') ||
      message.includes('como funcionas') ||
      message.includes('que sabes hacer') ||
      message.includes('comandos')
    );
  }

  private isOutOfBusinessScopeMessage(message: string) {
    const outOfScopeWords = [
      'python',
      'javascript',
      'java',
      'typescript',
      'programacion',
      'html',
      'css',
      'sql',
      'script',
      'funcion',
      'algoritmo',
      'hola mundo',
      'receta',
      'cocina',
      'historia',
      'matematica',
      'traduce',
      'traduccion',
      'poema',
      'cuento',
      'ensayo',
      'correo',
      'email',
      'cv',
      'curriculum',
    ];

    return this.hasAny(message, outOfScopeWords);
  }

  private isInventoryDomainMessage(message: string) {
    const domainWords = [
      'inventario',
      'stock',
      'producto',
      'productos',
      'articulo',
      'articulos',
      'codigo',
      'unidades',
      'unidad',
      'existencia',
      'existencias',
      'cantidad',
      'bajo',
      'minimo',
      'sin stock',
      'agotado',
      'agotados',
      'resumen',
      'ajuste',
      'buscar',
      'busca',
      'consultar',
      'consulta',
      'cuantos',
      'cuantas',
      'cuanto',
      'cuanta',
      'mayor',
      'menor',
      'menos',
      'mas',
      'reponer',
      'acabarse',
      'acabar',
      'terminarse',
      'terminar',
      'cloro',
      'detergente',
      'desinfectante',
      'limpiador',
      'limpieza',
      'shampoo',
      'jabon',
      'lavalozas',
      'insecticida',
      'virutilla',
      'fibra',
      'escoba',
      'papel',
      'cera',
    ];

    return this.hasAny(message, domainWords);
  }


  private extractProductInformationTerm(message: string) {
    const informationTriggers = [
      'que es',
      'que son',
      'que significa',
      'definicion de',
      'para que sirve',
      'para que se usa',
      'uso de',
      'usos de',
      'explica',
      'explicame',
      'informacion de',
      'informacion sobre',
    ];

    if (!this.hasAny(message, informationTriggers)) {
      return null;
    }

    const searchTerm = this.removeStopWords(message, [
      'que',
      'es',
      'son',
      'significa',
      'definicion',
      'de',
      'del',
      'la',
      'el',
      'los',
      'las',
      'un',
      'una',
      'unos',
      'unas',
      'para',
      'sirve',
      'se',
      'usa',
      'uso',
      'usos',
      'explica',
      'explicame',
      'informacion',
      'sobre',
      'producto',
      'productos',
      'articulo',
      'articulos',
      'inventario',
      'sicd',
      'pinval',
      'por',
      'favor',
    ]);

    const genericTerms = [
      'producto',
      'productos',
      'articulo',
      'articulos',
      'inventario',
      'stock',
      'cosa',
      'cosas',
    ];

    if (!searchTerm || searchTerm.length < 3 || genericTerms.includes(searchTerm)) {
      return null;
    }

    return searchTerm;
  }

  private getKnownProductInformation(searchTerm: string) {
    const term = normalizeText(searchTerm);
    const catalog: Array<{ keys: string[]; answer: string }> = [
      {
        keys: ['cloro', 'hipoclorito'],
        answer:
          'El cloro es un producto químico usado principalmente como desinfectante y limpiador. En inventario suele asociarse a productos de limpieza para baños, pisos, superficies y desinfección general. Debe manipularse con cuidado y no mezclarse con amoníaco, ácidos u otros químicos.',
      },
      {
        keys: ['detergente', 'detergentes'],
        answer:
          'El detergente es un producto de limpieza diseñado para remover grasa, suciedad y residuos. En un inventario puede aparecer asociado a lavado de ropa, limpieza general, cocina o superficies.',
      },
      {
        keys: ['desinfectante', 'desinfectantes'],
        answer:
          'Un desinfectante es un producto utilizado para reducir o eliminar microorganismos en superficies. En SICD puede servir para controlar productos destinados a higiene, limpieza y sanitización.',
      },
      {
        keys: ['shampoo', 'champu'],
        answer:
          'El shampoo es un producto de higiene usado para lavar el cabello o, según el tipo de producto, para limpieza especializada. En inventario se controla por stock, categoría, precio y proveedor.',
      },
      {
        keys: ['jabon', 'jabones'],
        answer:
          'El jabón es un producto de higiene o limpieza usado para remover suciedad y grasa. En inventario puede registrarse por unidades, formato, proveedor y stock mínimo.',
      },
      {
        keys: ['lavalozas', 'lavavajillas'],
        answer:
          'El lavalozas es un producto de limpieza usado para lavar utensilios de cocina y remover grasa. En inventario se puede controlar por stock disponible, proveedor y reposición.',
      },
      {
        keys: ['virutilla', 'fibra', 'esponja'],
        answer:
          'La virutilla, fibra o esponja es un insumo de limpieza usado para remover suciedad adherida en superficies o utensilios. En inventario se controla como producto de consumo frecuente.',
      },
      {
        keys: ['limpiavidrios', 'limpia vidrios'],
        answer:
          'El limpiavidrios es un producto usado para limpiar cristales, espejos y superficies similares. En inventario se puede controlar por unidades, formato, proveedor y stock disponible.',
      },
      {
        keys: ['insecticida', 'baygon'],
        answer:
          'Un insecticida es un producto destinado al control de insectos. Debe almacenarse y manipularse con precaución, siguiendo las indicaciones del fabricante.',
      },
    ];

    return catalog.find((entry) =>
      entry.keys.some((key) => term.includes(key) || key.includes(term)),
    )?.answer;
  }

  private isInventorySummaryIntent(message: string) {
    const summaryWords = ['resumen', 'general', 'total'];
    const inventoryWords = ['inventario', 'stock', 'productos', 'unidades'];

    return this.hasAny(message, summaryWords) && this.hasAny(message, inventoryWords);
  }

  private isAdjustmentIntent(message: string) {
    return (
      message.includes('ajuste') ||
      message.includes('stock negativo') ||
      message.includes('negativo') ||
      message.includes('negativos') ||
      message.includes('por ajustar')
    );
  }

  private isOutOfStockIntent(message: string) {
    return (
      message.includes('sin stock') ||
      message.includes('stock cero') ||
      message.includes('agotado') ||
      message.includes('agotados') ||
      message.includes('sin existencia') ||
      message.includes('sin existencias') ||
      message.includes('cero unidades')
    );
  }

  private isLowStockIntent(message: string) {
    const stockWords = ['stock', 'existencia', 'existencias', 'unidades', 'cantidad'];
    const lowWords = [
      'bajo',
      'poco',
      'poca',
      'minimo',
      'reponer',
      'critico',
      'critica',
    ];

    return this.hasAny(message, stockWords) && this.hasAny(message, lowWords);
  }

  private isLowestStockIntent(message: string) {
    const stockWords = ['stock', 'existencia', 'existencias', 'unidades', 'cantidad'];
    const lowestWords = ['menos', 'menor', 'bajo'];

    return (
      this.hasAny(message, stockWords) &&
      this.hasAny(message, lowestWords) &&
      !this.isLowStockIntent(message)
    );
  }

  private isHighestStockIntent(message: string) {
    const stockWords = ['stock', 'existencia', 'existencias', 'unidades', 'cantidad'];
    const highestWords = ['mas', 'mayor', 'alto'];

    return this.hasAny(message, stockWords) && this.hasAny(message, highestWords);
  }

  private extractProductScopedRanking(message: string):
    | { searchTerm: string; direction: 'LOWEST' | 'HIGHEST' }
    | null {
    const stockWords = ['stock', 'existencia', 'existencias', 'unidades', 'cantidad'];
    const lowestWords = ['menos', 'menor', 'bajo'];
    const highestWords = ['mas', 'mayor', 'alto'];

    const hasStock = this.hasAny(message, stockWords);
    const isLowest = this.hasAny(message, lowestWords);
    const isHighest = this.hasAny(message, highestWords);

    if (!hasStock || (!isLowest && !isHighest)) {
      return null;
    }

    const searchTerm = this.removeStopWords(message, [
      'cual',
      'cuales',
      'es',
      'son',
      'el',
      'la',
      'los',
      'las',
      'producto',
      'productos',
      'articulo',
      'articulos',
      'con',
      'de',
      'del',
      'que',
      'tiene',
      'tienen',
      'menos',
      'menor',
      'bajo',
      'poco',
      'poca',
      'mas',
      'mayor',
      'alto',
      'stock',
      'cantidad',
      'unidades',
      'unidad',
      'existencia',
      'existencias',
      'registrado',
      'registrada',
    ]);

    if (!searchTerm) {
      return null;
    }

    const genericTerms = ['inventario', 'stock', 'productos', 'producto'];

    if (genericTerms.includes(searchTerm)) {
      return null;
    }

    return {
      searchTerm,
      direction: isLowest ? 'LOWEST' : 'HIGHEST',
    };
  }

  private extractProductStockSearchTerm(message: string) {
    const stockWords = [
      'stock',
      'existencia',
      'existencias',
      'unidades',
      'unidad',
      'cantidad',
      'cuantos',
      'cuantas',
      'cuanto',
      'cuanta',
    ];

    if (!this.hasAny(message, stockWords)) {
      return null;
    }

    if (this.isGlobalInventoryQuestion(message)) {
      return null;
    }

    const searchTerm = this.removeStopWords(message, [
      'cuantos',
      'cuantas',
      'cuanto',
      'cuanta',
      'hay',
      'tengo',
      'tenemos',
      'en',
      'stock',
      'existencia',
      'existencias',
      'unidades',
      'unidad',
      'cantidad',
      'del',
      'de',
      'el',
      'la',
      'los',
      'las',
      'producto',
      'productos',
      'articulo',
      'articulos',
      'puedes',
      'podrias',
      'buscar',
      'busca',
      'consultar',
      'consulta',
      'quiero',
      'saber',
      'me',
      'por',
      'favor',
    ]);

    return searchTerm || null;
  }

  private extractExplicitProductSearchTerm(message: string) {
    const searchWords = ['buscar', 'busca', 'consultar', 'consulta', 'producto', 'codigo'];

    if (!this.hasAny(message, searchWords)) {
      return null;
    }

    const searchTerm = this.removeStopWords(message, [
      'buscar',
      'busca',
      'consultar',
      'consulta',
      'producto',
      'productos',
      'codigo',
      'el',
      'la',
      'los',
      'las',
      'de',
      'del',
      'por',
      'favor',
      'me',
      'puedes',
      'podrias',
      'quiero',
      'saber',
    ]);

    return searchTerm || null;
  }

  private isGlobalInventoryQuestion(message: string) {
    if (this.isInventorySummaryIntent(message)) return true;
    if (this.isAdjustmentIntent(message)) return true;
    if (this.isOutOfStockIntent(message)) return true;
    if (this.isLowStockIntent(message)) return true;

    const globalWords = ['inventario', 'productos', 'total', 'general'];

    return this.hasAny(message, globalWords) && !this.hasSpecificProductHint(message);
  }

  private hasSpecificProductHint(message: string) {
    const cleaned = this.removeStopWords(message, [
      'cuantos',
      'cuantas',
      'cuanto',
      'cuanta',
      'hay',
      'estan',
      'esta',
      'en',
      'stock',
      'existencia',
      'existencias',
      'unidades',
      'unidad',
      'cantidad',
      'producto',
      'productos',
      'bajo',
      'poco',
      'poca',
      'minimo',
      'sin',
      'agotado',
      'agotados',
    ]);

    return cleaned.length >= 3;
  }


  private buildProductInformationResponse(
    products: ProductResponse[],
    originalMessage: string,
    searchTerm: string,
  ): ChatbotResponse {
    const knownInformation = this.getKnownProductInformation(searchTerm);
    const searchVariants = this.buildSearchVariants(searchTerm);

    const matchedProducts = products.filter((product) => {
      const productCode = normalizeText(product.codigo);
      const productDescription = normalizeText(product.descrip);
      const productDisplayName = normalizeText(product.displayName ?? '');
      const productSearchName = normalizeText(product.searchName ?? '');
      const productFamily = normalizeText(product.familia ?? '');

      return searchVariants.some(
        (term) =>
          productCode.includes(term) ||
          productDescription.includes(term) ||
          productDisplayName.includes(term) ||
          productSearchName.includes(term) ||
          productFamily.includes(term),
      );
    });

    const visibleProducts = matchedProducts
      .slice(0, MAX_LIST_RESULTS)
      .map(toChatbotProduct);

    const totalUnits = matchedProducts.reduce(
      (total, product) => total + product.stock,
      0,
    );

    if (knownInformation) {
      const inventoryDetail = matchedProducts.length
        ? ` Además, encontré ${matchedProducts.length} producto${
            matchedProducts.length === 1 ? '' : 's'
          } relacionado${matchedProducts.length === 1 ? '' : 's'} con "${searchTerm}" en el inventario, con ${totalUnits} unidades disponibles en total.`
        : ` No encontré productos relacionados con "${searchTerm}" registrados actualmente en el inventario.`;

      return {
        type: matchedProducts.length ? 'PRODUCT_LIST' : 'GENERAL',
        answer: `${knownInformation}${inventoryDetail}`,
        products: visibleProducts,
        totalResults: matchedProducts.length,
      };
    }

    if (matchedProducts.length > 0) {
      return {
        type: 'PRODUCT_LIST',
        answer: `"${searchTerm}" aparece asociado a ${matchedProducts.length} producto${
          matchedProducts.length === 1 ? '' : 's'
        } del inventario SICD, con ${totalUnits} unidades disponibles en total. Puedo ayudarte a revisar su stock, productos similares o estado de reposición.`,
        products: visibleProducts,
        totalResults: matchedProducts.length,
      };
    }

    return {
      type: 'GENERAL',
      answer: `No tengo una definición segura para "${searchTerm}" dentro del contexto del inventario SICD y tampoco encontré productos asociados. Intenta buscarlo por nombre de producto, código o categoría.`,
    };
  }

  private buildProductList(
    products: ProductResponse[],
    description: { singular: string; plural: string },
  ): ChatbotResponse {
    const sortedProducts = [...products].sort(
      (a, b) => a.stock - b.stock || a.descrip.localeCompare(b.descrip),
    );

    const visibleProducts = sortedProducts
      .slice(0, MAX_LIST_RESULTS)
      .map(toChatbotProduct);

    const resultDetail =
      products.length > MAX_LIST_RESULTS
        ? ` Muestro los primeros ${MAX_LIST_RESULTS}.`
        : '';

    return {
      type: 'PRODUCT_LIST',
      answer: `Hay ${products.length} ${
        products.length === 1 ? 'producto' : 'productos'
      } que ${
        products.length === 1 ? description.singular : description.plural
      }.${resultDetail}`,
      products: visibleProducts,
      totalResults: products.length,
    };
  }

  private buildStockRanking(
    products: ProductResponse[],
    direction: 'LOWEST' | 'HIGHEST',
  ): ChatbotResponse {
    const validProducts = products.filter(
      (product) => product.dataIssue !== 'STOCK_NEGATIVO',
    );

    const sortedProducts = [...validProducts].sort((a, b) => {
      const stockDifference =
        direction === 'LOWEST' ? a.stock - b.stock : b.stock - a.stock;

      return stockDifference || a.descrip.localeCompare(b.descrip);
    });

    const visibleProducts = sortedProducts
      .slice(0, MAX_LIST_RESULTS)
      .map(toChatbotProduct);

    const rankingDescription =
      direction === 'LOWEST' ? 'menor stock' : 'mayor stock';

    return {
      type: 'PRODUCT_LIST',
      answer: `Estos son los ${visibleProducts.length} productos con ${rankingDescription} registrado.`,
      products: visibleProducts,
      totalResults: validProducts.length,
    };
  }

  private buildProductScopedStockRanking(
    products: ProductResponse[],
    searchTerm: string,
    direction: 'LOWEST' | 'HIGHEST',
  ): ChatbotResponse {
    const searchVariants = this.buildSearchVariants(searchTerm);

    const matchedProducts = products.filter((product) => {
      const productCode = normalizeText(product.codigo);
      const productDescription = normalizeText(product.descrip);
      const productDisplayName = normalizeText(product.displayName ?? '');
      const productSearchName = normalizeText(product.searchName ?? '');
      const productFamily = normalizeText(product.familia ?? '');

      return searchVariants.some(
        (term) =>
          productCode.includes(term) ||
          productDescription.includes(term) ||
          productDisplayName.includes(term) ||
          productSearchName.includes(term) ||
          productFamily.includes(term) ||
          term.includes(productDescription),
      );
    });

    if (matchedProducts.length === 0) {
      return {
        type: 'NOT_FOUND',
        answer: `No encontré productos relacionados con "${searchTerm}".`,
        product: null,
      };
    }

    const validProducts = matchedProducts.filter(
      (product) => product.dataIssue !== 'STOCK_NEGATIVO',
    );

    if (validProducts.length === 0) {
      return {
        type: 'PRODUCT_LIST',
        answer: `Encontré ${matchedProducts.length} productos relacionados con "${searchTerm}", pero todos requieren ajuste de stock.`,
        products: matchedProducts.slice(0, MAX_LIST_RESULTS).map(toChatbotProduct),
        totalResults: matchedProducts.length,
      };
    }

    const sortedProducts = [...validProducts].sort((a, b) => {
      const stockDifference =
        direction === 'LOWEST' ? a.stock - b.stock : b.stock - a.stock;

      return stockDifference || a.descrip.localeCompare(b.descrip);
    });

    const visibleProducts = sortedProducts
      .slice(0, MAX_LIST_RESULTS)
      .map(toChatbotProduct);

    const rankingText =
      direction === 'LOWEST' ? 'menor stock' : 'mayor stock';

    const resultDetail =
      sortedProducts.length > MAX_LIST_RESULTS
        ? ` Muestro los primeros ${MAX_LIST_RESULTS}.`
        : '';

    return {
      type: 'PRODUCT_LIST',
      answer: `Encontré ${matchedProducts.length} productos relacionados con "${searchTerm}". Estos son los productos con ${rankingText}.${resultDetail}`,
      products: visibleProducts,
      totalResults: matchedProducts.length,
    };
  }

  private buildInventorySummary(products: ProductResponse[]): ChatbotResponse {
    const summary = products.reduce(
      (totals, product) => {
        const status = getProductStatus(product);

        totals.totalProducts += 1;
        totals.totalUnits += product.stock;

        if (status === 'DISPONIBLE') totals.availableProducts += 1;
        if (status === 'BAJO_MINIMO') totals.lowStockProducts += 1;
        if (status === 'SIN_STOCK') totals.outOfStockProducts += 1;
        if (status === 'REQUIERE_AJUSTE') totals.adjustmentProducts += 1;

        return totals;
      },
      {
        totalProducts: 0,
        totalUnits: 0,
        availableProducts: 0,
        lowStockProducts: 0,
        outOfStockProducts: 0,
        adjustmentProducts: 0,
      },
    );

    return {
      type: 'INVENTORY_SUMMARY',
      answer: `El inventario registra ${summary.totalProducts} productos y ${summary.totalUnits} unidades disponibles.`,
      summary,
    };
  }

  private resolveAiIntent(
    aiIntent: AiIntent | null,
    products: ProductResponse[],
    originalMessage: string,
  ): ChatbotResponse | null {
    if (
      !aiIntent ||
      aiIntent.intent === 'UNKNOWN' ||
      aiIntent.intent === 'GENERAL'
    ) {
      return null;
    }

    if (aiIntent.intent === 'INVENTORY_SUMMARY') {
      return this.buildInventorySummary(products);
    }

    if (aiIntent.intent === 'ADJUSTMENTS') {
      return this.buildProductList(
        products.filter((product) => product.dataIssue === 'STOCK_NEGATIVO'),
        { singular: 'requiere ajuste', plural: 'requieren ajuste' },
      );
    }

    if (aiIntent.intent === 'OUT_OF_STOCK') {
      return this.buildProductList(
        products.filter(
          (product) =>
            product.dataIssue !== 'STOCK_NEGATIVO' && product.stock === 0,
        ),
        { singular: 'está sin stock', plural: 'están sin stock' },
      );
    }

    if (aiIntent.intent === 'LOW_STOCK') {
      return this.buildProductList(
        products.filter(
          (product) =>
            product.dataIssue !== 'STOCK_NEGATIVO' &&
            product.stock > 0 &&
            product.stock <= product.minStock,
        ),
        { singular: 'está bajo el mínimo', plural: 'están bajo el mínimo' },
      );
    }

    if (aiIntent.intent === 'LOWEST_STOCK') {
      return this.buildStockRanking(products, 'LOWEST');
    }

    if (aiIntent.intent === 'HIGHEST_STOCK') {
      return this.buildStockRanking(products, 'HIGHEST');
    }

    if (aiIntent.intent === 'PRODUCT_SEARCH' && aiIntent.searchTerm) {
      return this.searchProduct(
        products,
        originalMessage,
        normalizeText(aiIntent.searchTerm),
      );
    }

    return null;
  }

  private searchProduct(
    products: ProductResponse[],
    originalMessage: string,
    normalizedMessage: string,
  ): ChatbotResponse {
    const searchTerm = this.removeStopWords(normalizedMessage, [
      'stock',
      'producto',
      'productos',
      'codigo',
      'del',
      'de',
      'cuanto',
      'cuantos',
      'cuanta',
      'cuantas',
      'tiene',
      'hay',
      'consulta',
      'consultar',
      'buscar',
      'busca',
      'puedes',
      'podrias',
      'quiero',
      'saber',
      'el',
      'la',
      'los',
      'las',
      'en',
      'unidades',
      'unidad',
      'cantidad',
      'existencia',
      'existencias',
      'dame',
      'un',
      'una',
      'unos',
      'unas',
      'me',
      'por',
      'favor',
    ]);

    if (!searchTerm) {
      throw new BadRequestException(
        'Indica el código o nombre del producto que deseas consultar.',
      );
    }

    const searchVariants = this.buildSearchVariants(searchTerm);

    const exactMatch = products.find((product) =>
      searchVariants.some(
        (term) =>
          normalizeText(product.codigo) === term ||
          normalizeText(product.descrip) === term,
      ),
    );

    if (exactMatch) {
      return {
        type: 'PRODUCT',
        answer: `El producto ${exactMatch.descrip} (${exactMatch.codigo}) tiene ${exactMatch.stock} unidades disponibles.`,
        product: toChatbotProduct(exactMatch),
      };
    }

    const matchedProducts = products.filter((product) => {
      const productCode = normalizeText(product.codigo);
      const productDescription = normalizeText(product.descrip);
      const productDisplayName = normalizeText(product.displayName ?? '');
      const productSearchName = normalizeText(product.searchName ?? '');
      const productFamily = normalizeText(product.familia ?? '');

      return searchVariants.some(
        (term) =>
          productCode.includes(term) ||
          productDescription.includes(term) ||
          productDisplayName.includes(term) ||
          productSearchName.includes(term) ||
          productFamily.includes(term) ||
          term.includes(productDescription),
      );
    });

    if (matchedProducts.length === 0) {
      return {
        type: 'NOT_FOUND',
        answer: `No encontré un producto asociado a "${originalMessage}".`,
        product: null,
      };
    }

    if (matchedProducts.length === 1) {
      const product = matchedProducts[0];

      return {
        type: 'PRODUCT',
        answer: `El producto ${product.descrip} (${product.codigo}) tiene ${product.stock} unidades disponibles.`,
        product: toChatbotProduct(product),
      };
    }

    const sortedProducts = [...matchedProducts].sort(
      (a, b) => b.stock - a.stock || a.descrip.localeCompare(b.descrip),
    );

    const visibleProducts = sortedProducts
      .slice(0, MAX_LIST_RESULTS)
      .map(toChatbotProduct);

    const totalUnits = matchedProducts.reduce(
      (total, product) => total + product.stock,
      0,
    );

    const resultDetail =
      matchedProducts.length > MAX_LIST_RESULTS
        ? ` Muestro los primeros ${MAX_LIST_RESULTS}.`
        : '';

    return {
      type: 'PRODUCT_LIST',
      answer: `Encontré ${matchedProducts.length} productos relacionados con "${searchTerm}", con ${totalUnits} unidades disponibles en total.${resultDetail}`,
      products: visibleProducts,
      totalResults: matchedProducts.length,
    };
  }

  private buildSearchVariants(searchTerm: string) {
    const variants = new Set<string>();

    variants.add(searchTerm);

    const words = searchTerm.split(' ').filter(Boolean);

    for (const word of words) {
      variants.add(word);

      if (word.endsWith('s') && word.length > 3) {
        variants.add(word.slice(0, -1));
      }

      if (word.endsWith('es') && word.length > 4) {
        variants.add(word.slice(0, -2));
      }
    }

    if (searchTerm.endsWith('s') && searchTerm.length > 3) {
      variants.add(searchTerm.slice(0, -1));
    }

    if (searchTerm.endsWith('es') && searchTerm.length > 4) {
      variants.add(searchTerm.slice(0, -2));
    }

    return [...variants].filter((term) => term.length >= 3);
  }

  private hasAny(message: string, words: string[]) {
    return words.some((word) => message.includes(word));
  }

  private removeStopWords(message: string, stopWords: string[]) {
    const stopWordSet = new Set(stopWords);

    return message
      .split(' ')
      .filter((word) => word && !stopWordSet.has(word))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}