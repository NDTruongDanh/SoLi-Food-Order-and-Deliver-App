import type { ItemSearchRowDto } from '../standard/search.dto';
import type { RestaurantSearchResultDto } from '../../restaurant/dto/restaurant.dto';
import type { AiSearchFiltersSchema } from './ai-search-intent.schema';

export const AI_SEARCH_DEFAULT_RADIUS_KM = 5;
export const AI_SEARCH_MAX_QUERY_LENGTH = 300;

export type AiSearchFilters = AiSearchFiltersSchema;

export interface AiSearchQueryPlan {
  filters: AiSearchFilters;
  semanticQuery: string;
}

export interface AiSearchRepositoryFilters {
  filters: AiSearchFilters;
  queryEmbedding: number[];
  embeddingModel: string;
  embeddingVersion: string;
  lat?: number;
  lon?: number;
  radiusKm: number;
  limit: number;
  offset: number;
}

export interface AiSearchNutritionFacts {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  verifiedByRestaurant: boolean | null;
}

export interface AiSearchItemCandidate extends ItemSearchRowDto {
  nutrition: AiSearchNutritionFacts | null;
  semanticDistance: number;
}

export interface AiSearchItemResult extends ItemSearchRowDto {
  score: number;
  matchReasons: string[];
  nutrition: AiSearchNutritionFacts | null;
}

export type AiSearchMode = 'ai' | 'classic_fallback';
export type AiSearchAppliedFilterSource = 'request' | 'ai_inferred';

export interface AiSearchAppliedFilter {
  key: string;
  label: string;
  source: AiSearchAppliedFilterSource;
}

export type AiSearchFallbackReason =
  | 'ROUTER_UNAVAILABLE'
  | 'ROUTER_INVALID_RESPONSE'
  | 'EMBEDDING_FAILED';

export interface AiSearchResponse {
  mode: AiSearchMode;
  query: string;
  interpretation: string;
  appliedFilters: AiSearchAppliedFilter[];
  restaurants: RestaurantSearchResultDto[];
  items: AiSearchItemResult[];
  total: {
    restaurants: number;
    items: number;
  };
  followUps: [];
  fallback: null | {
    reason: AiSearchFallbackReason;
  };
}
