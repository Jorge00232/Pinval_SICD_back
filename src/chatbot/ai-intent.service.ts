import { Injectable, Logger } from '@nestjs/common';

export type AiIntentName =
  | 'INVENTORY_SUMMARY'
  | 'ADJUSTMENTS'
  | 'OUT_OF_STOCK'
  | 'LOW_STOCK'
  | 'LOWEST_STOCK'
  | 'HIGHEST_STOCK'
  | 'PRODUCT_SEARCH'
  | 'GENERAL'
  | 'UNKNOWN';

export type AiIntent = {
  intent: AiIntentName;
  searchTerm?: string;
};

const ALLOWED_INTENTS = new Set<AiIntentName>([
  'INVENTORY_SUMMARY',
  'ADJUSTMENTS',
  'OUT_OF_STOCK',
  'LOW_STOCK',
  'LOWEST_STOCK',
  'HIGHEST_STOCK',
  'PRODUCT_SEARCH',
  'GENERAL',
  'UNKNOWN',
]);

@Injectable()
export class AiIntentService {
  private readonly logger = new Logger(AiIntentService.name);

  async classify(message: string): Promise<AiIntent | null> {
    const systemPrompt =
      'Clasifica el mensaje del usuario para un sistema de inventario llamado Pinval SICD. ' +
      'Responde exclusivamente JSON válido, sin markdown, sin explicaciones. ' +
      'Formato: {"intent":"GENERAL"} o {"intent":"PRODUCT_SEARCH","searchTerm":"nombre o codigo"}. ' +
      'Intenciones permitidas: INVENTORY_SUMMARY, ADJUSTMENTS, OUT_OF_STOCK, LOW_STOCK, LOWEST_STOCK, ' +
      'HIGHEST_STOCK, PRODUCT_SEARCH, GENERAL, UNKNOWN. ' +
      'Usa GENERAL para saludos, ayuda o preguntas conceptuales sobre productos de inventario, por ejemplo qué es el cloro o para qué sirve un detergente. ' +
      'Usa UNKNOWN para temas externos al negocio. PRODUCT_SEARCH requiere searchTerm con solo el código o nombre del producto.';

    const content = await this.callCloudflare([
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: message,
      },
    ], {
      max_tokens: 120,
      temperature: 0,
    });

    if (!content) {
      return null;
    }

    try {
      return this.parseIntent(content);
    } catch (error) {
      this.logger.warn(
        `No se pudo parsear la intención de IA. Respuesta: ${content}. ${
          error instanceof Error ? error.message : ''
        }`,
      );
      return null;
    }
  }

  async generateAnswer(message: string): Promise<string | null> {
    const content = await this.callCloudflare([
      {
        role: 'system',
        content:
          'Eres el Asistente SICD de Pinval. Responde en español, de forma breve y útil. ' +
          'Puedes explicar que ayudas a consultar inventario, stock, productos bajo mínimo, productos sin stock, rankings, resumen de inventario y conceptos básicos de productos de limpieza o consumo registrados en inventario. ' +
          'No inventes datos de inventario. Si el usuario pide datos específicos, sugiere preguntar por producto, stock, bajo mínimo, sin stock o resumen.',
      },
      {
        role: 'user',
        content: message,
      },
    ], {
      max_tokens: 250,
      temperature: 0.3,
    });

    return content;
  }

  private async callCloudflare(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: { max_tokens?: number; temperature?: number },
  ): Promise<string | null> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_AI_TOKEN;
    const model = process.env.CLOUDFLARE_AI_MODEL;

    if (!accountId || !token || !model) {
      this.logger.warn(
        'Cloudflare AI no está configurado. Revisa CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN y CLOUDFLARE_AI_MODEL.',
      );
      return null;
    }

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages,
            max_tokens: options?.max_tokens ?? 200,
            temperature: options?.temperature ?? 0.2,
          }),
          signal: AbortSignal.timeout(12000),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.logger.warn(
          `Workers AI respondió con estado ${response.status}. ${errorText}`,
        );
        return null;
      }

      const data = (await response.json()) as {
        success?: boolean;
        errors?: unknown[];
        result?:
          | string
          | {
              response?: string;
              text?: string;
              output?: string;
              choices?: Array<{
                message?: { content?: string };
                text?: string;
              }>;
            };
      };

      return this.extractText(data);
    } catch (error) {
      this.logger.warn(
        `Workers AI no disponible. ${
          error instanceof Error ? error.message : ''
        }`,
      );
      return null;
    }
  }

  private extractText(data: {
    result?:
      | string
      | {
          response?: string;
          text?: string;
          output?: string;
          choices?: Array<{
            message?: { content?: string };
            text?: string;
          }>;
        };
  }): string | null {
    if (typeof data.result === 'string') {
      return data.result.trim() || null;
    }

    const result = data.result;

    if (!result) {
      return null;
    }

    const content =
      result.response ??
      result.text ??
      result.output ??
      result.choices?.[0]?.message?.content ??
      result.choices?.[0]?.text;

    return typeof content === 'string' && content.trim()
      ? content.trim()
      : null;
  }

  private parseIntent(content: string): AiIntent | null {
    const jsonText = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(jsonText) as Partial<AiIntent>;

    if (!parsed.intent || !ALLOWED_INTENTS.has(parsed.intent)) {
      return null;
    }

    const searchTerm =
      typeof parsed.searchTerm === 'string'
        ? parsed.searchTerm.trim().slice(0, 100)
        : undefined;

    if (parsed.intent === 'PRODUCT_SEARCH' && !searchTerm) {
      return null;
    }

    return {
      intent: parsed.intent,
      searchTerm,
    };
  }
}