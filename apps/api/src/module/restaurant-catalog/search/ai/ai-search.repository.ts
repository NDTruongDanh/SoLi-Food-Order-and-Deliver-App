import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, SQL, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import { menuItemNutrition } from '@/module/restaurant-catalog/nutrition/domain/nutrition.schema';
import {
  menuCategories,
  menuItems,
  menuItemStatusEnum,
} from '../../menu/menu.schema';
import { restaurants } from '../../restaurant/restaurant.schema';
import type {
  AiSearchFilters,
  AiSearchItemCandidate,
  AiSearchRepositoryFilters,
} from './ai-search.types';

const EARTH_RADIUS_KM = 6371;

const DIETARY_TAG_FILTERS = [
  ['isVegetarian', 'vegetarian'],
  ['isVegan', 'vegan'],
  ['isHalal', 'halal'],
  ['isGlutenFree', 'gluten-free'],
  ['isDairyFree', 'dairy-free'],
] as const satisfies ReadonlyArray<readonly [keyof AiSearchFilters, string]>;

@Injectable()
export class AiSearchRepository {
  constructor(@Inject(DB_CONNECTION) private readonly db: NodePgDatabase) {}

  async findItems(
    filters: AiSearchRepositoryFilters,
  ): Promise<AiSearchItemCandidate[]> {
    const conditions: SQL<unknown>[] = [
      eq(
        menuItems.status,
        'available' as (typeof menuItemStatusEnum.enumValues)[number],
      ),
      eq(restaurants.isApproved, true),
      eq(restaurants.isOpen, true),
      sql`${menuItems.embedding} IS NOT NULL`,
      sql`${menuItems.embeddingModel} = ${filters.embeddingModel}`,
      sql`${menuItems.embeddingVersion} = ${filters.embeddingVersion}`,
    ];

    this.applyHardFilters(conditions, filters.filters);
    this.applyLocationFilter(conditions, filters);

    const vectorDistance = sql<number>`${menuItems.embedding} <=> ${toVectorLiteral(
      filters.queryEmbedding,
    )}`;
    const rows = await this.db
      .select({
        id: menuItems.id,
        name: menuItems.name,
        description: menuItems.description,
        price: menuItems.price,
        itemKind: menuItems.itemKind,
        imageUrl: menuItems.imageUrl,
        tags: menuItems.tags,
        categoryName: menuCategories.name,
        calories: menuItemNutrition.calories,
        protein: menuItemNutrition.protein,
        carbs: menuItemNutrition.carbs,
        fat: menuItemNutrition.fat,
        verifiedByRestaurant: menuItemNutrition.verifiedByRestaurant,
        semanticDistance: vectorDistance,
        restaurantId: restaurants.id,
        restaurantName: restaurants.name,
        restaurantAddress: restaurants.address,
        cuisineType: restaurants.cuisineType,
        logoUrl: restaurants.logoUrl,
        coverImageUrl: restaurants.coverImageUrl,
        averageRating: restaurants.averageRating,
        ratingSum: restaurants.ratingSum,
        reviewCount: restaurants.reviewCount,
        restaurantLatitude: restaurants.latitude,
        restaurantLongitude: restaurants.longitude,
        distanceKm: this.buildDistanceExpr(filters),
      })
      .from(menuItems)
      .innerJoin(restaurants, eq(menuItems.restaurantId, restaurants.id))
      .leftJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
      .leftJoin(
        menuItemNutrition,
        eq(menuItemNutrition.menuItemId, menuItems.id),
      )
      .where(and(...conditions))
      .orderBy(vectorDistance, asc(menuItems.id))
      .limit(filters.limit)
      .offset(filters.offset);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      itemKind: row.itemKind,
      imageUrl: row.imageUrl,
      tags: row.tags,
      categoryName: row.categoryName,
      semanticDistance: numberOrZero(row.semanticDistance),
      nutrition:
        row.calories === null &&
        row.protein === null &&
        row.carbs === null &&
        row.fat === null
          ? null
          : {
              calories: numberOrNull(row.calories),
              protein: numberOrNull(row.protein),
              carbs: numberOrNull(row.carbs),
              fat: numberOrNull(row.fat),
              verifiedByRestaurant: row.verifiedByRestaurant ?? null,
            },
      restaurant: {
        id: row.restaurantId,
        name: row.restaurantName,
        address: row.restaurantAddress,
        cuisineType: row.cuisineType,
        logoUrl: row.logoUrl,
        coverImageUrl: row.coverImageUrl,
        averageRating: numberOrZero(row.averageRating),
        ratingSum: numberOrZero(row.ratingSum),
        reviewCount: numberOrZero(row.reviewCount),
        latitude: row.restaurantLatitude,
        longitude: row.restaurantLongitude,
        distanceKm: numberOrNull(row.distanceKm),
      },
    }));
  }

  private applyHardFilters(
    conditions: SQL<unknown>[],
    filters: AiSearchFilters,
  ): void {
    if (filters.itemKind !== undefined) {
      conditions.push(eq(menuItems.itemKind, filters.itemKind));
    }
    if (filters.minPriceVnd !== undefined) {
      conditions.push(sql`${menuItems.price} >= ${filters.minPriceVnd}`);
    }
    if (filters.maxPriceVnd !== undefined) {
      conditions.push(sql`${menuItems.price} <= ${filters.maxPriceVnd}`);
    }
    if (filters.minRating !== undefined) {
      conditions.push(
        sql`${restaurants.averageRating} >= ${filters.minRating}`,
      );
    }
    if (filters.minReviewCount !== undefined) {
      conditions.push(
        sql`${restaurants.reviewCount} >= ${filters.minReviewCount}`,
      );
    }

    for (const [key, tag] of DIETARY_TAG_FILTERS) {
      if (filters[key] === true) {
        conditions.push(
          sql`${tag} = ANY(COALESCE(${menuItems.tags}, ARRAY[]::text[]))`,
        );
      }
    }

    const hasNutritionConstraint =
      filters.minProteinG !== undefined ||
      filters.maxCalories !== undefined ||
      filters.maxFatG !== undefined ||
      filters.maxCarbsG !== undefined;
    if (hasNutritionConstraint) {
      conditions.push(eq(menuItemNutrition.verifiedByRestaurant, true));
    }
    if (filters.minProteinG !== undefined) {
      conditions.push(
        sql`${menuItemNutrition.protein} >= ${filters.minProteinG}`,
      );
    }
    if (filters.maxCalories !== undefined) {
      conditions.push(
        sql`${menuItemNutrition.calories} <= ${filters.maxCalories}`,
      );
    }
    if (filters.maxFatG !== undefined) {
      conditions.push(sql`${menuItemNutrition.fat} <= ${filters.maxFatG}`);
    }
    if (filters.maxCarbsG !== undefined) {
      conditions.push(sql`${menuItemNutrition.carbs} <= ${filters.maxCarbsG}`);
    }
  }

  private applyLocationFilter(
    conditions: SQL<unknown>[],
    filters: AiSearchRepositoryFilters,
  ): void {
    if (filters.lat === undefined || filters.lon === undefined) return;

    conditions.push(
      sql`${restaurants.latitude} IS NOT NULL AND ${restaurants.longitude} IS NOT NULL`,
    );

    const latDelta = filters.radiusKm / 111;
    const lonDelta =
      filters.radiusKm / (111 * Math.cos((filters.lat * Math.PI) / 180));

    conditions.push(
      sql`${restaurants.latitude} BETWEEN ${filters.lat - latDelta} AND ${filters.lat + latDelta}`,
    );
    conditions.push(
      sql`${restaurants.longitude} BETWEEN ${filters.lon - lonDelta} AND ${filters.lon + lonDelta}`,
    );
    conditions.push(
      sql`${this.buildDistanceExpr(filters)} <= ${filters.radiusKm}`,
    );
  }

  private buildDistanceExpr(filters: AiSearchRepositoryFilters): SQL<unknown> {
    if (filters.lat === undefined || filters.lon === undefined) {
      return sql<null>`null`;
    }

    return sql<number>`(
      2 * ${EARTH_RADIUS_KM} * ASIN(SQRT(
        POWER(SIN(RADIANS(${restaurants.latitude} - ${filters.lat}) / 2), 2) +
        COS(RADIANS(${filters.lat})) * COS(RADIANS(${restaurants.latitude})) *
        POWER(SIN(RADIANS(${restaurants.longitude} - ${filters.lon}) / 2), 2)
      ))
    )`;
  }
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toVectorLiteral(embedding: number[]): string {
  if (
    embedding.length === 0 ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Search embedding must contain only finite numbers.');
  }
  return `[${embedding.join(',')}]`;
}
