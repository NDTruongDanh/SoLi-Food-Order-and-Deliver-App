import type { AiSearchEmbeddingService } from '../indexing/ai-search-embedding.service';
import type { SearchService } from '../standard/search.service';
import type { AiSearchRepository } from './ai-search.repository';
import { AiSearchService } from './ai-search.service';
import type {
  AiSearchItemCandidate,
  AiSearchQueryPlan,
} from './ai-search.types';

const item: AiSearchItemCandidate = {
  id: 'item-1',
  name: 'Grilled Chicken Rice',
  description: 'Rice with grilled chicken',
  price: 45_000,
  itemKind: 'food',
  imageUrl: null,
  tags: ['high-protein'],
  categoryName: 'Rice',
  semanticDistance: 0.13,
  nutrition: {
    calories: 520,
    protein: 42,
    carbs: 60,
    fat: 10,
    verifiedByRestaurant: true,
  },
  restaurant: {
    id: 'restaurant-1',
    name: 'Healthy Bowl',
    address: 'District 1',
    cuisineType: 'Vietnamese',
    logoUrl: null,
    coverImageUrl: null,
    averageRating: 4.6,
    ratingSum: 46,
    reviewCount: 10,
    latitude: 10.76,
    longitude: 106.66,
    distanceKm: 1.2,
  },
};

describe('AiSearchService', () => {
  function buildService(overrides: {
    plan?: AiSearchQueryPlan | Record<string, unknown>;
    routerError?: Error;
    routerConfigured?: boolean;
    embeddingError?: Error;
    candidates?: AiSearchItemCandidate[];
  } = {}) {
    const repo = {
      findItems: jest.fn(() => Promise.resolve(overrides.candidates ?? [item])),
    };
    const standardSearch = {
      search: jest.fn(() =>
        Promise.resolve({ restaurants: [], items: [], total: { restaurants: 0, items: 0 } }),
      ),
    };
    const embeddings = {
      embedSearchDocument: jest.fn(() => {
        if (overrides.embeddingError) return Promise.reject(overrides.embeddingError);
        return Promise.resolve([0.1, 0.2]);
      }),
      getConfig: jest.fn(() => ({ model: 'embeddinggemma', version: '1' })),
    };
    const router = {
      isConfigured: jest.fn(() => overrides.routerConfigured ?? true),
      chat: jest.fn(() => {
        if (overrides.routerError) return Promise.reject(overrides.routerError);
        return Promise.resolve({
          model: 'gpt-oss:20b',
          content: JSON.stringify(
            overrides.plan ?? {
              filters: { maxPriceVnd: 50_000, minProteinG: 25 },
              semanticQuery: 'high protein chicken rice',
            },
          ),
        });
      }),
    };
    const config = {
      get: jest.fn((key: string) =>
        ({
          AI_SEARCH_ENABLED: true,
          AI_SEARCH_MODEL: 'gpt-oss:20b',
          AI_SEARCH_TIMEOUT_MS: 8_000,
        })[key],
      ),
    };

    return {
      service: new AiSearchService(
        repo as unknown as AiSearchRepository,
        standardSearch as unknown as SearchService,
        embeddings as unknown as AiSearchEmbeddingService,
        router as never,
        config as never,
      ),
      repo,
      standardSearch,
      embeddings,
      router,
    };
  }

  it('uses one semantic repository call and returns factual item reasons', async () => {
    const { service, repo, embeddings } = buildService();

    const response = await service.search({
      query: 'high protein chicken rice under 50000',
      lat: 10.76,
      lon: 106.66,
      radiusKm: 4,
      limit: 10,
      offset: 2,
    });

    expect(embeddings.embedSearchDocument).toHaveBeenCalledWith(
      'high protein chicken rice',
    );
    expect(repo.findItems).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { maxPriceVnd: 50_000, minProteinG: 25 },
        queryEmbedding: [0.1, 0.2],
        embeddingModel: 'embeddinggemma',
        embeddingVersion: '1',
        lat: 10.76,
        lon: 106.66,
        radiusKm: 4,
        limit: 10,
        offset: 2,
      }),
    );
    expect(response).toMatchObject({
      mode: 'ai',
      restaurants: [],
      total: { restaurants: 0, items: 1 },
      fallback: null,
      items: [
        expect.objectContaining({
          score: 87,
          matchReasons: ['Under 50,000 VND', '42g protein'],
        }),
      ],
    });
    expect(response.items[0]).not.toHaveProperty('semanticDistance');
  });

  it('uses classic raw-query fallback when the router is unavailable', async () => {
    const { service, standardSearch } = buildService({
      routerError: new Error('offline'),
    });

    const response = await service.search({ query: 'spicy noodles' });

    expect(standardSearch.search).toHaveBeenCalledWith(
      'spicy noodles',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(response).toMatchObject({
      mode: 'classic_fallback',
      fallback: { reason: 'ROUTER_UNAVAILABLE' },
    });
  });

  it('uses classic raw-query fallback when router JSON violates the schema', async () => {
    const { service, standardSearch } = buildService({
      plan: {
        filters: {},
        semanticQuery: 'spicy noodles',
        sort: 'price_asc',
      },
    });

    const response = await service.search({ query: 'spicy noodles' });

    expect(standardSearch.search).toHaveBeenCalledWith(
      'spicy noodles',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(response).toMatchObject({
      mode: 'classic_fallback',
      fallback: { reason: 'ROUTER_INVALID_RESPONSE' },
    });
  });

  it('uses classic raw-query fallback when embedding fails', async () => {
    const { service, standardSearch } = buildService({
      embeddingError: new Error('timeout'),
    });

    const response = await service.search({ query: 'spicy noodles' });

    expect(standardSearch.search).toHaveBeenCalledWith(
      'spicy noodles',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(response).toMatchObject({
      mode: 'classic_fallback',
      fallback: { reason: 'EMBEDDING_FAILED' },
    });
  });

  it('passes ambient location context to the integrated router without coordinates', async () => {
    const { service, router } = buildService({
      plan: { filters: {}, semanticQuery: 'pho' },
    });

    await service.search({
      query: 'pho near me',
      lat: 10.76,
      lon: 106.66,
      radiusKm: 4,
    });

    const call = router.chat.mock.calls[0][0];
    expect(call.messages[0].content).toContain('maxPriceVnd: 50000');
    const context = JSON.parse(call.messages[1].content) as Record<
      string,
      unknown
    >;
    expect(context).toMatchObject({
      query: 'pho near me',
      locationAvailable: true,
      defaultRadiusKm: 4,
    });
    expect(JSON.stringify(context)).not.toMatch(/lat|lon/i);
  });

  it('rejects partial coordinates before calling the integrated router', async () => {
    const { service, router } = buildService();

    await expect(service.search({ query: 'pho', lat: 10.76 })).rejects.toThrow(
      'lat and lon must both be provided together',
    );
    expect(router.chat).not.toHaveBeenCalled();
  });
});
