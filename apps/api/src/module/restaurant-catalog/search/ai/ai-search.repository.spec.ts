import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AiSearchRepository } from './ai-search.repository';

describe('AiSearchRepository', () => {
  it('executes one ordered menu-item query with base, hard, and location filters', async () => {
    const chain = buildQueryChain([
      {
        id: 'item-1',
        name: 'High Protein Bowl',
        description: null,
        price: 48_000,
        itemKind: 'food' as const,
        imageUrl: null,
        tags: ['vegetarian'],
        categoryName: 'Bowls',
        calories: 420,
        protein: 30,
        carbs: 45,
        fat: 10,
        verifiedByRestaurant: true,
        semanticDistance: 0.2,
        restaurantId: 'restaurant-1',
        restaurantName: 'Healthy Bowl',
        restaurantAddress: 'District 1',
        cuisineType: 'Vietnamese',
        logoUrl: null,
        coverImageUrl: null,
        averageRating: 4.5,
        ratingSum: 45,
        reviewCount: 10,
        restaurantLatitude: 10.76,
        restaurantLongitude: 106.66,
        distanceKm: 1.2,
      },
    ]);
    const repository = new AiSearchRepository(
      chain.db as unknown as NodePgDatabase,
    );

    const results = await repository.findItems({
      filters: {
        maxPriceVnd: 50_000,
        minProteinG: 25,
        minRating: 4.3,
        isVegetarian: true,
      },
      queryEmbedding: [0.1, 0.2, 0.3],
      embeddingModel: 'embeddinggemma',
      embeddingVersion: '1',
      lat: 10.76,
      lon: 106.66,
      radiusKm: 5,
      limit: 20,
      offset: 10,
    });

    expect(chain.select).toHaveBeenCalledTimes(1);
    expect(chain.from).toHaveBeenCalledTimes(1);
    expect(chain.innerJoin).toHaveBeenCalledTimes(1);
    expect(chain.leftJoin).toHaveBeenCalledTimes(2);
    expect(chain.where).toHaveBeenCalledTimes(1);
    expect(chain.orderBy).toHaveBeenCalledWith(expect.anything(), expect.anything());
    expect(chain.limit).toHaveBeenCalledWith(20);
    expect(chain.offset).toHaveBeenCalledWith(10);
    expect(results).toEqual([
      expect.objectContaining({
        id: 'item-1',
        semanticDistance: 0.2,
        nutrition: expect.objectContaining({ protein: 30 }),
        restaurant: expect.objectContaining({ distanceKm: 1.2 }),
      }),
    ]);
  });

  it('uses the same single-query path when the filter bucket is empty', async () => {
    const chain = buildQueryChain([]);
    const repository = new AiSearchRepository(
      chain.db as unknown as NodePgDatabase,
    );

    await expect(
      repository.findItems({
        filters: {},
        queryEmbedding: [0.1, 0.2, 0.3],
        embeddingModel: 'embeddinggemma',
        embeddingVersion: '1',
        radiusKm: 5,
        limit: 5,
        offset: 0,
      }),
    ).resolves.toEqual([]);

    expect(chain.select).toHaveBeenCalledTimes(1);
    expect(chain.offset).toHaveBeenCalledWith(0);
  });
});

function buildQueryChain(rows: unknown[]) {
  const offset = jest.fn(() => Promise.resolve(rows));
  const limit = jest.fn(() => ({ offset }));
  const orderBy = jest.fn(() => ({ limit }));
  const where = jest.fn(() => ({ orderBy }));
  const leftJoin = jest.fn(() => ({ leftJoin, where }));
  const innerJoin = jest.fn(() => ({ leftJoin }));
  const from = jest.fn(() => ({ innerJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    db: { select },
    select,
    from,
    innerJoin,
    leftJoin,
    where,
    orderBy,
    limit,
    offset,
  };
}
