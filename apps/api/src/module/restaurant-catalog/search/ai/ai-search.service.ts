import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { recordAiSearch } from '@/observability/domain-metrics';
import {
  OllamaAiProvider,
  type AiChatMessage,
} from '@/lib/ai/ollama-ai.provider';
import { AiSearchEmbeddingService } from '../indexing/ai-search-embedding.service';
import { SearchService } from '../standard/search.service';
import type { AiSearchRequestDto } from './ai-search.dto';
import { AI_SEARCH_SYSTEM_PROMPT } from './ai-search-prompt';
import { AiSearchRepository } from './ai-search.repository';
import {
  AI_SEARCH_DEFAULT_RADIUS_KM,
  type AiSearchAppliedFilter,
  type AiSearchFallbackReason,
  type AiSearchFilters,
  type AiSearchItemCandidate,
  type AiSearchItemResult,
  type AiSearchResponse,
} from './ai-search.types';

const optionalMoney = z.number().int().min(0).max(10_000_000).optional();
const optionalNutrition = z.number().min(0).max(5_000).optional();

const aiSearchFiltersSchema = z
  .object({
    minPriceVnd: optionalMoney,
    maxPriceVnd: optionalMoney,
    minProteinG: z.number().min(0).max(300).optional(),
    maxCalories: optionalNutrition,
    maxFatG: z.number().min(0).max(500).optional(),
    maxCarbsG: z.number().min(0).max(1_000).optional(),
    minRating: z.number().min(0).max(5).optional(),
    minReviewCount: z.number().int().min(0).max(100_000).optional(),
    itemKind: z.enum(['food', 'beverage', 'mixed']).optional(),
    isVegetarian: z.boolean().optional(),
    isVegan: z.boolean().optional(),
    isHalal: z.boolean().optional(),
    isGlutenFree: z.boolean().optional(),
    isDairyFree: z.boolean().optional(),
  })
  .strict();

const aiSearchIntentSchema = z
  .object({
    filters: aiSearchFiltersSchema,
    semanticQuery: z.string().trim().min(1).max(300),
  })
  .strict();

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const AI_SEARCH_TIMEOUT_MS = 8_000;
const AI_SEARCH_RESPONSE_SCHEMA_PROMPT = [
  'JSON shape:',
  '{',
  '  "filters": {',
  '    "minPriceVnd": "integer | omitted",',
  '    "maxPriceVnd": "integer | omitted",',
  '    "minProteinG": "number | omitted",',
  '    "maxCalories": "number | omitted",',
  '    "maxFatG": "number | omitted",',
  '    "maxCarbsG": "number | omitted",',
  '    "minRating": "number | omitted",',
  '    "minReviewCount": "integer | omitted",',
  '    "itemKind": "food|beverage|mixed | omitted",',
  '    "isVegetarian": "boolean | omitted",',
  '    "isVegan": "boolean | omitted",',
  '    "isHalal": "boolean | omitted",',
  '    "isGlutenFree": "boolean | omitted",',
  '    "isDairyFree": "boolean | omitted"',
  '  },',
  '  "semanticQuery": "string"',
  '}',
].join('\n');

const DIETARY_FILTER_LABELS = [
  ['isVegetarian', 'Vegetarian'],
  ['isVegan', 'Vegan'],
  ['isHalal', 'Halal'],
  ['isGlutenFree', 'Gluten-free'],
  ['isDairyFree', 'Dairy-free'],
] as const satisfies ReadonlyArray<readonly [keyof AiSearchFilters, string]>;

export class AiSearchRouterError extends Error {
  constructor(readonly reason: AiSearchFallbackReason, message: string) {
    super(message);
    this.name = AiSearchRouterError.name;
  }
}

interface RouterOptions {
  radiusKm: number;
  hasLocation: boolean;
  now?: Date;
}

@Injectable()
export class AiSearchService {
  private readonly logger = new Logger(AiSearchService.name);

  constructor(
    private readonly repo: AiSearchRepository,
    private readonly standardSearch: SearchService,
    private readonly embeddings: AiSearchEmbeddingService,
    @Optional() private readonly aiProvider?: OllamaAiProvider,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async search(request: AiSearchRequestDto): Promise<AiSearchResponse> {
    const startedAt = Date.now();
    const query = request.query.trim();
    const limit = Math.min(request.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = Math.max(request.offset ?? 0, 0);
    const radiusKm = request.radiusKm ?? AI_SEARCH_DEFAULT_RADIUS_KM;

    if (!query) {
      return this.emptyResponse(query, startedAt);
    }
    if ((request.lat === undefined) !== (request.lon === undefined)) {
      throw new BadRequestException(
        'lat and lon must both be provided together for AI search',
      );
    }

    let plan;
    try {
      plan = await this.parseQueryPlan(query, {
        radiusKm,
        hasLocation: request.lat !== undefined && request.lon !== undefined,
      });
    } catch (error) {
      return this.fallbackToClassic(
        query,
        request,
        this.routerFailureReason(error),
        startedAt,
      );
    }

    let embedding: number[];
    try {
      embedding = await this.embeddings.embedSearchDocument(plan.semanticQuery);
    } catch (error) {
      this.logger.warn(
        `AI search embedding failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.fallbackToClassic(
        query,
        request,
        'EMBEDDING_FAILED',
        startedAt,
      );
    }

    const embeddingConfig = this.embeddings.getConfig();
    const candidates = await this.repo.findItems({
      filters: plan.filters,
      queryEmbedding: embedding,
      embeddingModel: embeddingConfig.model,
      embeddingVersion: embeddingConfig.version,
      lat: request.lat,
      lon: request.lon,
      radiusKm,
      limit,
      offset,
    });
    const items = candidates.map((candidate) =>
      this.toItemResult(candidate, plan.filters),
    );
    const response: AiSearchResponse = {
      mode: 'ai',
      query,
      interpretation: `Showing menu items matching "${plan.semanticQuery}".`,
      appliedFilters: this.buildAppliedFilters(plan.filters),
      restaurants: [],
      items,
      total: { restaurants: 0, items: items.length },
      followUps: [],
      fallback: null,
    };

    this.recordSearch(response, startedAt);
    return response;
  }

  private async parseQueryPlan(
    query: string,
    options: RouterOptions,
  ) {
    if (!this.shouldUseAiProvider()) {
      throw new AiSearchRouterError(
        'ROUTER_UNAVAILABLE',
        'AI search router is not enabled or configured.',
      );
    }

    let content: string;
    try {
      const response = await this.aiProvider!.chat({
        messages: this.buildRouterMessages(query, options),
        model: this.resolveAiSearchModel(),
        timeoutMs: this.resolveAiSearchTimeoutMs(),
        temperature: 0,
      });
      content = response.content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI search router failed: ${message}`);
      throw new AiSearchRouterError('ROUTER_UNAVAILABLE', message);
    }

    try {
      return aiSearchIntentSchema.parse(JSON.parse(content));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI search router returned invalid JSON: ${message}`);
      throw new AiSearchRouterError('ROUTER_INVALID_RESPONSE', message);
    }
  }

  private shouldUseAiProvider(): boolean {
    return (
      this.readBooleanConfig('AI_SEARCH_ENABLED', false) &&
      Boolean(this.aiProvider?.isConfigured())
    );
  }

  private resolveAiSearchModel(): string | undefined {
    const model = this.config?.get<string>('AI_SEARCH_MODEL')?.trim();
    return model && model.length > 0 ? model : undefined;
  }

  private resolveAiSearchTimeoutMs(): number {
    const value = Number(
      this.config?.get<number | string>('AI_SEARCH_TIMEOUT_MS'),
    );
    return Number.isInteger(value) && value > 0 ? value : AI_SEARCH_TIMEOUT_MS;
  }

  private buildRouterMessages(
    query: string,
    options: RouterOptions,
  ): AiChatMessage[] {
    return [
      {
        role: 'system',
        content: `${AI_SEARCH_SYSTEM_PROMPT}\n\n${AI_SEARCH_RESPONSE_SCHEMA_PROMPT}`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          query: query.trim().slice(0, 300),
          currentTime: (options.now ?? new Date()).toISOString(),
          locationAvailable: options.hasLocation,
          defaultRadiusKm: options.radiusKm,
        }),
      },
    ];
  }

  private async fallbackToClassic(
    query: string,
    request: AiSearchRequestDto,
    reason: AiSearchFallbackReason,
    startedAt: number,
  ): Promise<AiSearchResponse> {
    const classic = await this.standardSearch.search(
      query,
      undefined,
      undefined,
      undefined,
      request.lat,
      request.lon,
      request.radiusKm,
      request.offset,
      request.limit,
    );
    const response: AiSearchResponse = {
      mode: 'classic_fallback',
      query,
      interpretation: 'Showing regular search results.',
      appliedFilters: [],
      restaurants: classic.restaurants.map((restaurant) => ({
        ...restaurant,
        score: Number(restaurant.score ?? 0),
      })),
      items: classic.items.map((item) => ({
        ...item,
        score: Number(item.score ?? 0),
        matchReasons: [],
        nutrition: null,
      })),
      total: classic.total,
      followUps: [],
      fallback: { reason },
    };
    this.recordSearch(response, startedAt);
    return response;
  }

  private emptyResponse(query: string, startedAt: number): AiSearchResponse {
    const response: AiSearchResponse = {
      mode: 'ai',
      query,
      interpretation: 'Enter a food search to start.',
      appliedFilters: [],
      restaurants: [],
      items: [],
      total: { restaurants: 0, items: 0 },
      followUps: [],
      fallback: null,
    };
    this.recordSearch(response, startedAt);
    return response;
  }

  private toItemResult(
    candidate: AiSearchItemCandidate,
    filters: AiSearchFilters,
  ): AiSearchItemResult {
    const { semanticDistance, ...item } = candidate;
    return {
      ...item,
      score: Math.round(
        Math.max(0, Math.min(1, 1 - semanticDistance)) * 100,
      ),
      matchReasons: this.buildMatchReasons(candidate, filters),
    };
  }

  private buildMatchReasons(
    item: AiSearchItemCandidate,
    filters: AiSearchFilters,
  ): string[] {
    const reasons: string[] = [];
    if (filters.maxPriceVnd !== undefined) {
      reasons.push(`Under ${formatVnd(filters.maxPriceVnd)} VND`);
    }
    if (filters.minPriceVnd !== undefined) {
      reasons.push(`At least ${formatVnd(filters.minPriceVnd)} VND`);
    }
    const protein = item.nutrition?.protein;
    if (filters.minProteinG !== undefined && protein != null) {
      reasons.push(`${formatNumber(protein)}g protein`);
    }
    const calories = item.nutrition?.calories;
    if (filters.maxCalories !== undefined && calories != null) {
      reasons.push(`${formatNumber(calories)} calories`);
    }
    const fat = item.nutrition?.fat;
    if (filters.maxFatG !== undefined && fat != null) {
      reasons.push(`${formatNumber(fat)}g fat`);
    }
    const carbs = item.nutrition?.carbs;
    if (filters.maxCarbsG !== undefined && carbs != null) {
      reasons.push(`${formatNumber(carbs)}g carbs`);
    }
    if (filters.minRating !== undefined) {
      reasons.push(`${item.restaurant.averageRating.toFixed(1)} rating`);
    }
    if (filters.minReviewCount !== undefined) {
      reasons.push(`${item.restaurant.reviewCount} reviews`);
    }
    if (filters.itemKind !== undefined) {
      reasons.push(formatItemKind(filters.itemKind));
    }
    for (const [key, label] of DIETARY_FILTER_LABELS) {
      if (filters[key] === true) reasons.push(label);
    }
    return reasons;
  }

  private buildAppliedFilters(filters: AiSearchFilters): AiSearchAppliedFilter[] {
    const applied: AiSearchAppliedFilter[] = [];
    const add = (key: string, label: string) =>
      applied.push({ key, label, source: 'ai_inferred' });

    if (filters.minPriceVnd !== undefined)
      add('minPriceVnd', `Price from ${formatVnd(filters.minPriceVnd)} VND`);
    if (filters.maxPriceVnd !== undefined)
      add('maxPriceVnd', `Up to ${formatVnd(filters.maxPriceVnd)} VND`);
    if (filters.minProteinG !== undefined)
      add('minProteinG', `Protein ≥ ${formatNumber(filters.minProteinG)}g`);
    if (filters.maxCalories !== undefined)
      add('maxCalories', `Calories ≤ ${formatNumber(filters.maxCalories)}`);
    if (filters.maxFatG !== undefined)
      add('maxFatG', `Fat ≤ ${formatNumber(filters.maxFatG)}g`);
    if (filters.maxCarbsG !== undefined)
      add('maxCarbsG', `Carbs ≤ ${formatNumber(filters.maxCarbsG)}g`);
    if (filters.minRating !== undefined)
      add('minRating', `Rating ≥ ${formatNumber(filters.minRating)}`);
    if (filters.minReviewCount !== undefined)
      add('minReviewCount', `At least ${filters.minReviewCount} reviews`);
    if (filters.itemKind !== undefined)
      add('itemKind', formatItemKind(filters.itemKind));
    for (const [key, label] of DIETARY_FILTER_LABELS) {
      if (filters[key] === true) add(key, label);
    }
    return applied;
  }

  private routerFailureReason(error: unknown): AiSearchFallbackReason {
    return error instanceof AiSearchRouterError
      ? error.reason
      : 'ROUTER_UNAVAILABLE';
  }

  private readBooleanConfig(key: string, fallback: boolean): boolean {
    const value = this.config?.get<boolean | string>(key);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
    }
    return fallback;
  }

  private recordSearch(response: AiSearchResponse, startedAt: number): void {
    recordAiSearch({
      mode: response.mode,
      fallbackReason: response.fallback?.reason,
      itemCount: response.total.items,
      restaurantCount: response.total.restaurants,
      latencyMs: Date.now() - startedAt,
    });
  }
}

function formatVnd(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatItemKind(kind: AiSearchFilters['itemKind']): string {
  if (kind === 'beverage') return 'Beverage';
  if (kind === 'mixed') return 'Food and beverages';
  return 'Food';
}
