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
        'buscar producto por codigo o nombre',
        'consultar stock de un producto',
        'productos bajo minimo',
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
          'Hola. Soy el Asistente SICD. Puedo ayudarte solo con consultas de inventario: stock, productos, productos bajo mínimo, productos sin stock, ajustes y resumen de inventario.',
      };
    }

    if (this.isHelpIntent(normalizedMessage)) {
      return {
        type: 'GENERAL',
        answer:
          'Puedes preguntarme cosas como: "resumen de inventario", "productos bajo mínimo", "productos sin stock", "productos con menos stock", "cuántos cloros hay en stock" o "cuál es el shampoo con menos stock".',
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
        'Lo siento, no puedo responder eso. Solo puedo ayudarte con consultas relacionadas al inventario SICD: stock, productos, productos bajo mínimo, productos sin stock, ajustes y resumen de inventario.',
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
    ];

    return this.hasAny(message, domainWords);
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

      return searchVariants.some(
        (term) =>
          productCode.includes(term) ||
          productDescription.includes(term) ||
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
        'Indica el codigo o nombre del producto que deseas consultar.',
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

      return searchVariants.some(
        (term) =>
          productCode.includes(term) ||
          productDescription.includes(term) ||
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