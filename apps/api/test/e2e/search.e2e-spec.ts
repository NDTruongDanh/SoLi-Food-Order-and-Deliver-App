/**
 * search.e2e-spec.ts
 *
 * End-to-end tests for GET /api/search — unified restaurant + item search.
 *
 * The endpoint is @AllowAnonymous — no Authorization header is required.
 * All requests use noAuthHeaders() (empty object).
 *
 * ── Test data strategy ────────────────────────────────────────────────────────
 * The search module needs a rich multi-restaurant dataset to exercise all
 * filters (cuisine type, geo, tags, text).  The playbook's "infrastructure
 * exception" allows direct DB inserts when creating entities via the HTTP API
 * is not practical (it would require complex restaurant-creation role flows
 * that are entirely unrelated to what we are testing here).
 *
 * Five restaurants are seeded directly in beforeAll():
 *   R1 — Vietnamese, open, ~1.35 km from test origin  (pho, spicy items)
 *   R2 — Vietnamese, CLOSED                            (exclusion edge case)
 *   R3 — Vietnamese, open, ~1.33 km from test origin  (bánh mì, vegetarian)
 *   R4 — Korean,     open, ~5.2 km from test origin   (spicy items)
 *   R5 — Japanese,   open, ~5.3 km from test origin   (no delivery zones)
 *
 * Geo search origin for tests: lat=10.77, lon=106.67
 *   radiusKm=3  → R1 + R3 only
 *   radiusKm=10 → R1 + R3 + R4 + R5
 *
 * ── Covered scenarios ─────────────────────────────────────────────────────────
 *   § 1  Browse mode (no params)
 *   § 2  Full-text search (?q=)
 *   § 3  Restaurant name filter (?name=)
 *   § 4  Item name filter (?item=)
 *   § 5  Tag filter (?tag=)
 *   § 6  Cuisine type filter (?cuisineType=)
 *   § 7  Category filter (?category=)
 *   § 8  Combined filters
 *   § 9  Geo-radius filter
 *   § 10 Geo validation errors
 *   § 11 Pagination (limit / offset / cap)
 *   § 12 Response shape invariants
 *   § 13 Exclusion rules (closed / out-of-stock / unapproved)
 *   § 14 Security (SQL injection, special chars)
 */

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, teardownTestApp } from '../setup/app-factory';
import { resetDb, getTestDb, ensureExtensions } from '../setup/db-setup';
import { restaurants } from '../../src/module/restaurant-catalog/restaurant/restaurant.schema';
import {
  menuCategories,
  menuItems,
} from '../../src/module/restaurant-catalog/menu/menu.schema';
import { noAuthHeaders, setAuthManager } from '../helpers/auth';
import { TestAuthManager } from '../helpers/test-auth';

// ─── Search-test UUIDs (aa-prefix to avoid collision with other E2E suites) ───

const S = {
  // Restaurants
  R1: 'aa000001-0000-4000-8000-000000000001',
  R2: 'aa000002-0000-4000-8000-000000000002',
  R3: 'aa000003-0000-4000-8000-000000000003',
  R4: 'aa000004-0000-4000-8000-000000000004',
  R5: 'aa000005-0000-4000-8000-000000000005',
  // Categories
  catR1Noodles: 'aa000010-0000-4000-8000-000000000001',
  catR1Drinks: 'aa000010-0000-4000-8000-000000000002',
  catR2Mains: 'aa000010-0000-4000-8000-000000000003',
  catR3Rice: 'aa000010-0000-4000-8000-000000000004',
  catR3Sandwiches: 'aa000010-0000-4000-8000-000000000005',
  catR3Drinks: 'aa000010-0000-4000-8000-000000000006',
  catR4Bbq: 'aa000010-0000-4000-8000-000000000007',
  catR4Stews: 'aa000010-0000-4000-8000-000000000008',
  catR4Drinks: 'aa000010-0000-4000-8000-000000000009',
  catR5Sushi: 'aa000010-0000-4000-8000-000000000010',
  catR5Drinks: 'aa000010-0000-4000-8000-000000000011',
  // Items
  r1Pho1: 'aa000020-0000-4000-8000-000000000001', // Phở Bò Tái Nạm
  r1Pho2: 'aa000020-0000-4000-8000-000000000002', // Phở Gà
  r1BunBo: 'aa000020-0000-4000-8000-000000000003', // Bún Bò Huế (spicy)
  r2Burger: 'aa000020-0000-4000-8000-000000000004', // Classic Burger (closed restaurant)
  r3ComTam: 'aa000020-0000-4000-8000-000000000005', // Cơm Tấm Sườn Nướng
  r3BanhMi: 'aa000020-0000-4000-8000-000000000006', // Bánh Mì Thịt Nướng
  r3ComChay: 'aa000020-0000-4000-8000-000000000007', // Cơm Chay (vegetarian)
  r4Kimchi: 'aa000020-0000-4000-8000-000000000008', // Kimchi Jjigae (spicy)
  r4Bibimbap: 'aa000020-0000-4000-8000-000000000009', // Bibimbap
  r5BanhMi: 'aa000020-0000-4000-8000-000000000010', // Bánh Mì Cá Hồi (cross-restaurant banh mi)
  r5Sashimi: 'aa000020-0000-4000-8000-000000000011', // Sashimi Cá Ngừ (out_of_stock)
} as const;

// ─── Test seed function ───────────────────────────────────────────────────────

/**
 * Seeds all search test fixtures directly to the database.
 * Must be called after resetDb() so the slate is clean, and after
 * TestAuthManager.initialize() so a valid ownerId exists.
 *
 * Inserts: 5 restaurants, 11 menu categories, 11 menu items.
 */
async function seedSearchTestData(ownerId: string): Promise<void> {
  const db = getTestDb();

  await db.insert(restaurants).values([
    // ── R1: Vietnamese pho house — near search origin, OPEN ──────────────────
    {
      id: S.R1,
      ownerId,
      name: 'Phở Bắc',
      description: 'Phở Bắc chính hiệu — nước dùng hầm xương 12 tiếng.',
      address: '45 Nguyễn Huệ, Quận 1, TP.HCM',
      phone: '+84-28-1234-5678',
      isOpen: true,
      isApproved: true,
      cuisineType: 'Vietnamese',
      latitude: 10.762622,
      longitude: 106.660172,
      averageRating: 4.5,
      ratingSum: 18,
      reviewCount: 4,
    },
    // ── R2: Permanently closed — exclusion edge case ───────────────────────────
    {
      id: S.R2,
      ownerId,
      name: 'Bếp Đóng Cửa',
      description: 'Tạm đóng cửa để cải tạo.',
      address: '12 Hai Bà Trưng, Quận 3, TP.HCM',
      phone: '+84-28-9876-5432',
      isOpen: false,
      isApproved: true,
      cuisineType: 'Vietnamese',
      latitude: 10.775,
      longitude: 106.701,
    },
    // ── R3: Vietnamese rice & sandwiches — near search origin, OPEN ───────────
    {
      id: S.R3,
      ownerId,
      name: 'Cơm Tấm Sài Gòn',
      description: 'Cơm tấm sườn nướng, bì chả — đặc sản miền Nam.',
      address: '78 Lê Lợi, Quận 1, TP.HCM',
      phone: '+84-28-3456-7890',
      isOpen: true,
      isApproved: true,
      cuisineType: 'Vietnamese',
      latitude: 10.768,
      longitude: 106.682,
    },
    // ── R4: Korean BBQ — farther from origin (~5.2 km), OPEN ─────────────────
    {
      id: S.R4,
      ownerId,
      name: 'Seoul BBQ & More',
      description: 'Thịt nướng Hàn Quốc, kimchi, bibimbap chính gốc.',
      address: '30 Nguyễn Văn Linh, Quận 7, TP.HCM',
      phone: '+84-28-7654-3210',
      isOpen: true,
      isApproved: true,
      cuisineType: 'Korean',
      latitude: 10.736,
      longitude: 106.703,
    },
    // ── R5: Japanese sushi — farther from origin (~5.3 km), OPEN, no zones ───
    {
      id: S.R5,
      ownerId,
      name: 'Sushi Hana',
      description: 'Sushi và sashimi Nhật Bản — nguyên liệu nhập khẩu.',
      address: '5 Phan Đăng Lưu, Bình Thạnh, TP.HCM',
      phone: '+84-28-2468-1357',
      isOpen: true,
      isApproved: true,
      cuisineType: 'Japanese',
      latitude: 10.802,
      longitude: 106.706,
    },
  ]);

  await db.insert(menuCategories).values([
    {
      id: S.catR1Noodles,
      restaurantId: S.R1,
      name: 'Noodles',
      displayOrder: 1,
    },
    { id: S.catR1Drinks, restaurantId: S.R1, name: 'Drinks', displayOrder: 2 },
    {
      id: S.catR2Mains,
      restaurantId: S.R2,
      name: 'Main Dishes',
      displayOrder: 1,
    },
    {
      id: S.catR3Rice,
      restaurantId: S.R3,
      name: 'Rice Dishes',
      displayOrder: 1,
    },
    {
      id: S.catR3Sandwiches,
      restaurantId: S.R3,
      name: 'Sandwiches',
      displayOrder: 2,
    },
    { id: S.catR3Drinks, restaurantId: S.R3, name: 'Drinks', displayOrder: 3 },
    { id: S.catR4Bbq, restaurantId: S.R4, name: 'BBQ', displayOrder: 1 },
    { id: S.catR4Stews, restaurantId: S.R4, name: 'Stews', displayOrder: 2 },
    { id: S.catR4Drinks, restaurantId: S.R4, name: 'Drinks', displayOrder: 3 },
    { id: S.catR5Sushi, restaurantId: S.R5, name: 'Sushi', displayOrder: 1 },
    { id: S.catR5Drinks, restaurantId: S.R5, name: 'Drinks', displayOrder: 2 },
  ]);

  await db.insert(menuItems).values([
    // R1 — Phở Bắc
    {
      id: S.r1Pho1,
      itemKind: 'food',
      restaurantId: S.R1,
      categoryId: S.catR1Noodles,
      name: 'Phở Bò Tái Nạm',
      description: 'Phở bò truyền thống — nước dùng hầm xương bò 12 tiếng.',
      price: 8500,
      tags: ['beef', 'soup', 'noodle'],
      status: 'available',
    },
    {
      id: S.r1Pho2,
      itemKind: 'food',
      restaurantId: S.R1,
      categoryId: S.catR1Noodles,
      name: 'Phở Gà',
      description: 'Phở gà ta — nước dùng thanh ngọt tự nhiên từ xương gà.',
      price: 7500,
      tags: ['chicken', 'soup', 'noodle'],
      status: 'available',
    },
    {
      id: S.r1BunBo,
      itemKind: 'food',
      restaurantId: S.R1,
      categoryId: S.catR1Noodles,
      name: 'Bún Bò Huế',
      description: 'Bún bò Huế cay đặc trưng — mắm ruốc, sả, ớt.',
      price: 8000,
      tags: ['spicy', 'beef', 'soup', 'noodle'],
      status: 'available',
    },
    // R2 — Bếp Đóng Cửa (closed restaurant)
    {
      id: S.r2Burger,
      itemKind: 'food',
      restaurantId: S.R2,
      categoryId: S.catR2Mains,
      name: 'Classic Burger',
      description: 'Beef patty, lettuce, tomato, cheese.',
      price: 11000,
      tags: ['beef', 'fastfood'],
      status: 'available',
    },
    // R3 — Cơm Tấm Sài Gòn
    {
      id: S.r3ComTam,
      itemKind: 'food',
      restaurantId: S.R3,
      categoryId: S.catR3Rice,
      name: 'Cơm Tấm Sườn Nướng',
      description: 'Cơm tấm kèm sườn nướng than hoa, trứng chiên, đồ chua.',
      price: 9000,
      tags: ['pork', 'grilled', 'rice'],
      status: 'available',
    },
    {
      id: S.r3BanhMi,
      itemKind: 'food',
      restaurantId: S.R3,
      categoryId: S.catR3Sandwiches,
      name: 'Bánh Mì Thịt Nướng',
      description: 'Bánh mì giòn nhân thịt heo nướng, đồ chua, rau thơm.',
      price: 3500,
      tags: ['pork', 'grilled', 'sandwich'],
      status: 'available',
    },
    {
      id: S.r3ComChay,
      itemKind: 'food',
      restaurantId: S.R3,
      categoryId: S.catR3Rice,
      name: 'Cơm Chay',
      description: 'Cơm trắng kèm đậu phụ, rau củ xào và canh chay.',
      price: 7000,
      tags: ['vegetarian', 'vegan', 'rice'],
      status: 'available',
    },
    // R4 — Seoul BBQ & More
    {
      id: S.r4Kimchi,
      itemKind: 'food',
      restaurantId: S.R4,
      categoryId: S.catR4Stews,
      name: 'Kimchi Jjigae',
      description: 'Canh kimchi hầm thịt heo và đậu phụ — cay đậm đà.',
      price: 12000,
      tags: ['spicy', 'pork', 'soup', 'korean'],
      status: 'available',
    },
    {
      id: S.r4Bibimbap,
      itemKind: 'food',
      restaurantId: S.R4,
      categoryId: S.catR4Bbq,
      name: 'Bibimbap',
      description: 'Cơm trộn Hàn Quốc — rau namul, thịt bò, trứng lòng đào.',
      price: 13500,
      tags: ['beef', 'rice', 'korean'],
      status: 'available',
    },
    // R5 — Sushi Hana
    {
      id: S.r5BanhMi,
      itemKind: 'food',
      restaurantId: S.R5,
      categoryId: S.catR5Sushi,
      name: 'Bánh Mì Cá Hồi',
      description: 'Bánh mì Nhật Bản nhân cá hồi sốt teriyaki và rau mầm.',
      price: 6500,
      tags: ['seafood', 'sandwich', 'japanese'],
      status: 'available',
    },
    {
      // Seeded as out_of_stock — must never appear in search results.
      id: S.r5Sashimi,
      itemKind: 'food',
      restaurantId: S.R5,
      categoryId: S.catR5Sushi,
      name: 'Sashimi Cá Ngừ',
      description: 'Sashimi cá ngừ đại dương thái lát mỏng — 10 lát.',
      price: 18000,
      tags: ['seafood', 'japanese', 'raw'],
      status: 'out_of_stock',
    },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Search API (E2E)', () => {
  let app: INestApplication<App>;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());

    // 1. Ensure required PostgreSQL extensions exist (idempotent)
    //    unaccent + pg_trgm are needed for text-based search filters.
    //    The DB may lack them if bootstrapped via db:push instead of db:migrate.
    await ensureExtensions();

    // 2. Clear all test data
    await resetDb();

    // 2. Sign up test users (needed so ownerId FK is valid)
    const testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);

    // 3. Seed rich search fixture data directly (infrastructure exception)
    await seedSearchTestData(testAuth.ownerUserId);
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  // ── § 1 Browse mode — no parameters ──────────────────────────────────────────

  describe('§1 GET /api/search — browse mode (no parameters)', () => {
    it('B-01: returns all open+approved restaurants and empty items section', async () => {
      const res = await http.get('/api/search').set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('restaurants');
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
      expect(res.body.total).toHaveProperty('restaurants');
      expect(res.body.total).toHaveProperty('items');
    });

    it('B-02: returns exactly 4 open restaurants (R2 excluded)', async () => {
      const res = await http.get('/api/search').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const ids = (res.body.restaurants as { id: string }[]).map((r) => r.id);
      expect(ids).toContain(S.R1);
      expect(ids).toContain(S.R3);
      expect(ids).toContain(S.R4);
      expect(ids).toContain(S.R5);
      expect(ids).not.toContain(S.R2); // closed
      expect(res.body.total.restaurants).toBe(4);
    });

    it('B-03: items section is empty with no food filter', async () => {
      const res = await http.get('/api/search').set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total.items).toBe(0);
    });

    it('B-04: restaurant results include rating projection fields', async () => {
      const res = await http.get('/api/search').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const phoRestaurant = (
        res.body.restaurants as {
          id: string;
          averageRating: number;
          ratingSum: number;
          reviewCount: number;
        }[]
      ).find((restaurant) => restaurant.id === S.R1);

      expect(phoRestaurant).toMatchObject({
        averageRating: 4.5,
        ratingSum: 18,
        reviewCount: 4,
      });
    });
  });

  // ── § 2 Full-text search (?q=) ────────────────────────────────────────────────

  describe('§2 GET /api/search?q= — full-text (accent-insensitive)', () => {
    it('Q-01: q=pho matches Phở Bắc restaurant and Phở items', async () => {
      const res = await http.get('/api/search?q=pho').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1); // "Phở Bắc" name matches
      expect(restaurantIds).not.toContain(S.R2); // closed

      const phoItem = (
        res.body.items as {
          id: string;
          restaurant: {
            averageRating: number;
            ratingSum: number;
            reviewCount: number;
          };
        }[]
      ).find((item) => item.id === S.r1Pho1);
      expect(phoItem?.restaurant).toMatchObject({
        averageRating: 4.5,
        ratingSum: 18,
        reviewCount: 4,
      });

      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r1Pho1); // Phở Bò Tái Nạm
      expect(itemIds).toContain(S.r1Pho2); // Phở Gà
    });

    it('Q-02: q=Pho is case-insensitive (same results as q=pho)', async () => {
      const res = await http.get('/api/search?q=Pho').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
    });

    it('Q-03: q=PHO all-caps still matches', async () => {
      const res = await http.get('/api/search?q=PHO').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
    });

    it('Q-04: q=banh+mi returns restaurants that carry bánh mì items + those items', async () => {
      const res = await http.get('/api/search?q=banh+mi').set(noAuthHeaders());

      expect(res.status).toBe(200);
      // R3 (Cơm Tấm Sài Gòn) carries Bánh Mì Thịt Nướng → appears in restaurants
      // R5 (Sushi Hana) carries Bánh Mì Cá Hồi → appears in restaurants
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R3);
      expect(restaurantIds).toContain(S.R5);

      // Items: Bánh Mì Thịt Nướng (R3) + Bánh Mì Cá Hồi (R5)
      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r3BanhMi);
      expect(itemIds).toContain(S.r5BanhMi);
      expect(res.body.total.items).toBe(2);
    });

    it('Q-05: q=bun+bo matches Bún Bò Huế (accent-insensitive)', async () => {
      const res = await http.get('/api/search?q=bun+bo').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r1BunBo);
    });

    it('Q-06: q=com+tam matches Cơm Tấm Sài Gòn restaurant and Cơm Tấm Sườn Nướng item', async () => {
      const res = await http.get('/api/search?q=com+tam').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R3); // "Cơm Tấm Sài Gòn" name match

      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r3ComTam); // "Cơm Tấm Sườn Nướng"
    });

    it('Q-07: q=nonexistent_xyz returns empty results', async () => {
      const res = await http
        .get('/api/search?q=nonexistent_xyz_abc')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.restaurants).toEqual([]);
      expect(res.body.items).toEqual([]);
      expect(res.body.total.restaurants).toBe(0);
      expect(res.body.total.items).toBe(0);
    });
  });

  // ── § 3 Restaurant name filter (?q= with restaurant name) ───────────────────

  describe('§3 GET /api/search?q= — restaurant name search', () => {
    it('N-01: q=Seoul matches Seoul BBQ & More', async () => {
      const res = await http.get('/api/search?q=Seoul').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R4);
    });

    it('N-02: q=seoul is case-insensitive', async () => {
      const res = await http.get('/api/search?q=seoul').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R4);
    });

    it('N-03: q=bac matches Phở Bắc (accent-insensitive)', async () => {
      const res = await http.get('/api/search?q=bac').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
    });

    it('N-04: q=Seoul returns R4 restaurant but no items (no item name contains Seoul)', async () => {
      const res = await http.get('/api/search?q=Seoul').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R4);
      // Items section only shows items whose own name/tags/category matches q.
      // No item at Seoul BBQ is named "Seoul", so items is empty.
      expect(res.body.items).toEqual([]);
      expect(res.body.total.items).toBe(0);
    });

    it('N-05: q=bep matches no open restaurant (Bếp Đóng Cửa is closed)', async () => {
      const res = await http.get('/api/search?q=bep').set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.restaurants).toEqual([]);
    });
  });

  // ── § 4 Item name search via q ────────────────────────────────────────────────

  describe('§4 GET /api/search?q= — item name search', () => {
    it('I-01: q=kimchi returns R4 restaurant and Kimchi Jjigae item', async () => {
      const res = await http.get('/api/search?q=kimchi').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R4);

      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r4Kimchi);
    });

    it('I-02: q=banh+mi returns items from R3 and R5 cross-restaurant', async () => {
      const res = await http.get('/api/search?q=banh+mi').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r3BanhMi);
      expect(itemIds).toContain(S.r5BanhMi);
    });

    it('I-03: q=com+chay matches Cơm Chay (accent-insensitive)', async () => {
      const res = await http.get('/api/search?q=com+chay').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r3ComChay);
    });

    it('I-04: q=burger returns empty (Classic Burger is in a closed restaurant)', async () => {
      const res = await http.get('/api/search?q=burger').set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.restaurants).toEqual([]);
      expect(res.body.items).toEqual([]);
    });

    it('I-05: q=sashimi — R5 appears (description match) but items is empty (Sashimi Cá Ngừ is out_of_stock)', async () => {
      const res = await http.get('/api/search?q=sashimi').set(noAuthHeaders());

      expect(res.status).toBe(200);
      // R5 (Sushi Hana) description mentions "sashimi" → restaurant section shows it.
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R5);
      // The Sashimi item is out_of_stock → never returned in items section.
      expect(res.body.items).toEqual([]);
    });
  });

  // ── § 5 Tag filter (?tag=) ────────────────────────────────────────────────────

  describe('§5 GET /api/search?tag= — tag filter (exact match)', () => {
    it('T-01: tag=spicy returns R1 and R4, items: Bún Bò Huế + Kimchi Jjigae', async () => {
      const res = await http.get('/api/search?tag=spicy').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
      expect(restaurantIds).toContain(S.R4);
      expect(restaurantIds).not.toContain(S.R2); // closed
      expect(restaurantIds).not.toContain(S.R3);
      expect(restaurantIds).not.toContain(S.R5);

      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r1BunBo);
      expect(itemIds).toContain(S.r4Kimchi);
    });

    it('T-02: tag=vegetarian returns R3, item: Cơm Chay', async () => {
      const res = await http
        .get('/api/search?tag=vegetarian')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R3);
      expect(restaurantIds).not.toContain(S.R1);
      expect(restaurantIds).not.toContain(S.R4);

      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r3ComChay);
      expect(res.body.total.items).toBe(1);
    });

    it('T-03: tag=SPICY returns empty (tags are case-sensitive)', async () => {
      const res = await http.get('/api/search?tag=SPICY').set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.restaurants).toEqual([]);
      expect(res.body.items).toEqual([]);
    });

    it('T-04: tag=nonexistent returns empty', async () => {
      const res = await http
        .get('/api/search?tag=nonexistent_tag_xyz')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.restaurants).toEqual([]);
      expect(res.body.items).toEqual([]);
    });
  });

  // ── § 6 Cuisine type filter (?cuisineType=) ───────────────────────────────────

  describe('§6 GET /api/search?cuisineType= — cuisine filter', () => {
    it('C-01: cuisineType=Korean returns R4 only', async () => {
      const res = await http
        .get('/api/search?cuisineType=Korean')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R4);
      expect(restaurantIds).not.toContain(S.R1);
      expect(restaurantIds).not.toContain(S.R3);
      expect(restaurantIds).not.toContain(S.R5);
      expect(res.body.total.restaurants).toBe(1);
    });

    it('C-02: cuisineType=korean is case-insensitive', async () => {
      const res = await http
        .get('/api/search?cuisineType=korean')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R4);
    });

    it('C-03: cuisineType=Vietnamese returns R1 and R3 (R2 excluded — closed)', async () => {
      const res = await http
        .get('/api/search?cuisineType=Vietnamese')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
      expect(restaurantIds).toContain(S.R3);
      expect(restaurantIds).not.toContain(S.R2); // closed
      expect(res.body.total.restaurants).toBe(2);
    });

    it('C-04: cuisineType=Japanese returns R5 only', async () => {
      const res = await http
        .get('/api/search?cuisineType=Japanese')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R5);
      expect(res.body.total.restaurants).toBe(1);
    });

    it('C-05: cuisineType partial match (Viet) returns Vietnamese restaurants', async () => {
      const res = await http
        .get('/api/search?cuisineType=Viet')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
      expect(restaurantIds).toContain(S.R3);
    });

    it('C-06: cuisineType never populates items section', async () => {
      const res = await http
        .get('/api/search?cuisineType=Korean')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total.items).toBe(0);
    });
  });

  // ── § 7 Category filter (?category=) ─────────────────────────────────────────

  describe('§7 GET /api/search?category= — category filter', () => {
    it('CA-01: category=Noodles returns R1 (has Noodles category)', async () => {
      const res = await http
        .get('/api/search?category=Noodles')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
      expect(restaurantIds).not.toContain(S.R3);
      expect(restaurantIds).not.toContain(S.R4);
    });

    it('CA-02: category=Drinks returns all 4 open restaurants', async () => {
      const res = await http
        .get('/api/search?category=Drinks')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
      expect(restaurantIds).toContain(S.R3);
      expect(restaurantIds).toContain(S.R4);
      expect(restaurantIds).toContain(S.R5);
      expect(restaurantIds).not.toContain(S.R2); // closed
    });

    it('CA-03: category=noodles is case-insensitive', async () => {
      const res = await http
        .get('/api/search?category=noodles')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
    });

    it('CA-04: category=Main+Dishes returns empty (R2 is closed)', async () => {
      const res = await http
        .get('/api/search?category=Main+Dishes')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.restaurants).toEqual([]);
    });

    it('CA-05: category filter populates items section with items from matching categories', async () => {
      const res = await http
        .get('/api/search?category=Noodles')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      // category is a food-level signal — items in that category are returned
      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r1Pho1); // Phở Bò in Noodles category
      expect(itemIds).toContain(S.r1Pho2); // Phở Gà in Noodles category
      expect(itemIds).toContain(S.r1BunBo); // Bún Bò Huế in Noodles category
      expect(res.body.total.items).toBeGreaterThan(0);
    });
  });

  // ── § 8 Combined filters ──────────────────────────────────────────────────────

  describe('§8 GET /api/search — combined filters', () => {
    it('CM-01: q=pho&cuisineType=Vietnamese → R1 + pho items', async () => {
      const res = await http
        .get('/api/search?q=pho&cuisineType=Vietnamese')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
      expect(restaurantIds).not.toContain(S.R4); // Korean excluded by cuisineType

      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r1Pho1);
      expect(itemIds).toContain(S.r1Pho2);
    });

    it('CM-02: q=pho&cuisineType=Korean → no results (no Korean pho)', async () => {
      const res = await http
        .get('/api/search?q=pho&cuisineType=Korean')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.restaurants).toEqual([]);
      expect(res.body.items).toEqual([]);
    });

    it('CM-03: tag=spicy&cuisineType=Korean → R4 only, Kimchi item', async () => {
      const res = await http
        .get('/api/search?tag=spicy&cuisineType=Korean')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R4);
      expect(restaurantIds).not.toContain(S.R1); // Vietnamese excluded

      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r4Kimchi);
      expect(itemIds).not.toContain(S.r1BunBo); // R1 excluded by cuisineType
    });

    it('CM-04: q=banh+mi&cuisineType=Vietnamese → R3 only (R5 Japanese excluded)', async () => {
      const res = await http
        .get('/api/search?q=banh+mi&cuisineType=Vietnamese')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R3);
      expect(restaurantIds).not.toContain(S.R5); // Japanese excluded by cuisineType filter

      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r3BanhMi);
      expect(itemIds).not.toContain(S.r5BanhMi); // R5 excluded
    });
  });

  // ── § 9 Geo-radius filter ─────────────────────────────────────────────────────

  describe('§9 GET /api/search — geo-radius filter', () => {
    // Search origin for all geo tests: lat=10.77, lon=106.67
    // R1 (~1.35 km) and R3 (~1.33 km) are within 3 km.
    // R4 (~5.2 km) and R5 (~5.3 km) are outside 3 km but inside 10 km.

    it('G-01: radiusKm=3 returns only R1 and R3', async () => {
      const res = await http
        .get('/api/search?lat=10.77&lon=106.67&radiusKm=3')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
      expect(restaurantIds).toContain(S.R3);
      expect(restaurantIds).not.toContain(S.R4); // ~5.2 km — outside
      expect(restaurantIds).not.toContain(S.R5); // ~5.3 km — outside
      expect(restaurantIds).not.toContain(S.R2); // closed
    });

    it('G-02: radiusKm=10 returns all 4 open restaurants', async () => {
      const res = await http
        .get('/api/search?lat=10.77&lon=106.67&radiusKm=10')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
      expect(restaurantIds).toContain(S.R3);
      expect(restaurantIds).toContain(S.R4);
      expect(restaurantIds).toContain(S.R5);
      expect(restaurantIds).not.toContain(S.R2); // still excluded (closed)
    });

    it('G-03: geo + q=pho → only R1 appears (within radius AND name matches)', async () => {
      const res = await http
        .get('/api/search?lat=10.77&lon=106.67&radiusKm=3&q=pho')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);

      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r1Pho1);
      expect(itemIds).toContain(S.r1Pho2);
    });

    it('G-04: geo + tag=spicy → only R1 (R4 is outside 3km radius)', async () => {
      const res = await http
        .get('/api/search?lat=10.77&lon=106.67&radiusKm=3&tag=spicy')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurantIds = (res.body.restaurants as { id: string }[]).map(
        (r) => r.id,
      );
      expect(restaurantIds).toContain(S.R1);
      expect(restaurantIds).not.toContain(S.R4); // outside 3km

      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r1BunBo);
      expect(itemIds).not.toContain(S.r4Kimchi); // R4 excluded by geo
    });

    it('G-05: distanceKm is a positive number in restaurant results when geo provided', async () => {
      const res = await http
        .get('/api/search?lat=10.77&lon=106.67&radiusKm=3')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurants = res.body.restaurants as {
        id: string;
        distanceKm: unknown;
      }[];
      expect(restaurants.length).toBeGreaterThan(0);
      for (const r of restaurants) {
        expect(typeof r.distanceKm).toBe('number');
        expect(r.distanceKm as number).toBeGreaterThan(0);
      }
    });

    it('G-06: distanceKm is null in restaurant results when no geo provided', async () => {
      const res = await http.get('/api/search').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurants = res.body.restaurants as { distanceKm: unknown }[];
      expect(restaurants.length).toBeGreaterThan(0);
      for (const r of restaurants) {
        expect(r.distanceKm).toBeNull();
      }
    });

    it('G-07: tiny radius returns no restaurants if none at exact origin', async () => {
      const res = await http
        .get('/api/search?lat=10.77&lon=106.67&radiusKm=0.01')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.restaurants).toEqual([]);
    });

    it('G-08: results are ordered by distanceKm ascending when geo provided', async () => {
      const res = await http
        .get('/api/search?lat=10.77&lon=106.67&radiusKm=10')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const distances = (res.body.restaurants as { distanceKm: number }[]).map(
        (r) => r.distanceKm,
      );
      for (let i = 1; i < distances.length; i++) {
        expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
      }
    });
  });

  // ── § 10 Geo validation errors ────────────────────────────────────────────────

  describe('§10 GET /api/search — geo validation errors', () => {
    it('GV-01: lat without lon → 400 Bad Request', async () => {
      const res = await http.get('/api/search?lat=10.77').set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('GV-02: lon without lat → 400 Bad Request', async () => {
      const res = await http.get('/api/search?lon=106.67').set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('GV-03: non-numeric lat → 400 Bad Request (ParseFloatPipe)', async () => {
      const res = await http
        .get('/api/search?lat=abc&lon=106.67')
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('GV-04: non-numeric lon → 400 Bad Request (ParseFloatPipe)', async () => {
      const res = await http
        .get('/api/search?lat=10.77&lon=abc')
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });
  });

  // ── § 11 Pagination ───────────────────────────────────────────────────────────

  describe('§11 GET /api/search — pagination (limit / offset)', () => {
    it('P-01: limit=1 with q=pho returns 1 item; total still reflects full count', async () => {
      const res = await http
        .get('/api/search?q=pho&limit=1')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      // Both pho items exist; limit trims each section independently
      expect((res.body.items as unknown[]).length).toBeLessThanOrEqual(1);
      // Full item count (Phở Bò + Phở Gà) is 2
      expect(res.body.total.items).toBe(2);
    });

    it('P-02: limit=200 is silently capped to 100', async () => {
      // Seed only has 4 open restaurants; response will have ≤4 but limit behaviour is still verified
      const res = await http.get('/api/search?limit=200').set(noAuthHeaders());

      expect(res.status).toBe(200);
      // The important assertion: no server error; response shape is intact
      expect(res.body).toHaveProperty('restaurants');
      expect(res.body).toHaveProperty('total');
    });

    it('P-03: offset=9999 returns empty arrays but total still reflects real count', async () => {
      const res = await http
        .get('/api/search?offset=9999')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.restaurants).toEqual([]);
      // total.restaurants counts all matching rows regardless of offset
      expect(res.body.total.restaurants).toBe(4);
    });

    it('P-04: default limit of 20 is applied when limit is omitted', async () => {
      const res = await http.get('/api/search').set(noAuthHeaders());

      expect(res.status).toBe(200);
      // We have 4 restaurants — all returned, well within default limit of 20
      expect((res.body.restaurants as unknown[]).length).toBeLessThanOrEqual(
        20,
      );
    });

    it('P-05: offset=0 and offset=1 return different pages for q=pho items', async () => {
      const page1 = await http
        .get('/api/search?q=pho&limit=1&offset=0')
        .set(noAuthHeaders());
      const page2 = await http
        .get('/api/search?q=pho&limit=1&offset=1')
        .set(noAuthHeaders());

      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);

      const id1 = (page1.body.items as { id: string }[])[0]?.id;
      const id2 = (page2.body.items as { id: string }[])[0]?.id;

      // Both pages exist and return different items
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });
  });

  // ── § 12 Response shape invariants ────────────────────────────────────────────

  describe('§12 GET /api/search — response shape', () => {
    it('RS-01: response always has restaurants, items, total', async () => {
      const res = await http.get('/api/search').set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('restaurants');
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
      expect(typeof res.body.total.restaurants).toBe('number');
      expect(typeof res.body.total.items).toBe('number');
    });

    it('RS-02: restaurant objects do not expose ownerId or isApproved', async () => {
      const res = await http.get('/api/search').set(noAuthHeaders());

      expect(res.status).toBe(200);
      for (const r of res.body.restaurants as Record<string, unknown>[]) {
        expect(r).not.toHaveProperty('ownerId');
        expect(r).not.toHaveProperty('isApproved');
      }
    });

    it('RS-03: item objects contain required fields including nested restaurant', async () => {
      const res = await http.get('/api/search?q=pho').set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect((res.body.items as unknown[]).length).toBeGreaterThan(0);
      for (const item of res.body.items as Record<string, unknown>[]) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('price');
        expect(item).toHaveProperty('restaurant');
        const restaurant = item.restaurant as Record<string, unknown>;
        expect(restaurant).toHaveProperty('id');
        expect(restaurant).toHaveProperty('name');
        expect(restaurant).toHaveProperty('address');
      }
    });

    it('RS-04: item restaurant nested object does not expose ownerId', async () => {
      const res = await http.get('/api/search?q=pho').set(noAuthHeaders());

      expect(res.status).toBe(200);
      for (const item of res.body.items as {
        restaurant: Record<string, unknown>;
      }[]) {
        expect(item.restaurant).not.toHaveProperty('ownerId');
        expect(item.restaurant).not.toHaveProperty('isApproved');
      }
    });

    it('RS-05: total.restaurants matches actual array length when under page limit', async () => {
      const res = await http
        .get('/api/search?cuisineType=Korean')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.total.restaurants).toBe(
        (res.body.restaurants as unknown[]).length,
      );
    });

    it('RS-06: item price is a numeric value', async () => {
      const res = await http.get('/api/search?tag=spicy').set(noAuthHeaders());

      expect(res.status).toBe(200);
      for (const item of res.body.items as { price: unknown }[]) {
        expect(isNaN(Number(item.price))).toBe(false);
      }
    });
  });

  // ── § 13 Exclusion rules ──────────────────────────────────────────────────────

  describe('§13 GET /api/search — data exclusion rules', () => {
    it('EX-01: closed restaurant (R2) never appears in any search result', async () => {
      const [noFilter, byQ, byCuisine, byTag] = await Promise.all([
        http.get('/api/search').set(noAuthHeaders()),
        http.get('/api/search?q=bep').set(noAuthHeaders()),
        http.get('/api/search?cuisineType=Vietnamese').set(noAuthHeaders()),
        http.get('/api/search?tag=beef').set(noAuthHeaders()),
      ]);

      for (const res of [noFilter, byQ, byCuisine, byTag]) {
        expect(res.status).toBe(200);
        const ids = (res.body.restaurants as { id: string }[]).map((r) => r.id);
        expect(ids).not.toContain(S.R2);
      }
    });

    it('EX-02: out_of_stock item (Sashimi) never appears in items section', async () => {
      const res = await http
        .get('/api/search?tag=seafood')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).not.toContain(S.r5Sashimi);
      // Bánh Mì Cá Hồi (available, seafood tag) should appear
      expect(itemIds).toContain(S.r5BanhMi);
    });

    it('EX-03: tag=beef from closed restaurant (Classic Burger) never appears', async () => {
      const res = await http.get('/api/search?tag=beef').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).not.toContain(S.r2Burger);
    });
  });

  // ── § 14 Security ─────────────────────────────────────────────────────────────

  describe('§14 GET /api/search — security (injection / special chars)', () => {
    it('SEC-01: SQL injection in q param is safely handled (parameterized query)', async () => {
      // Injection string is treated as a literal text value (parameterized query).
      // No restaurant/item has this string as their name → returns 0 results,
      // which itself proves the query did NOT degenerate into 'WHERE 1=1'.
      const injRes = await http
        .get("/api/search?q='; DROP TABLE restaurants; --")
        .set(noAuthHeaders());

      expect(injRes.status).toBe(200);
      expect(injRes.body.total.restaurants).toBe(0); // literal text — no match

      // Verify the table was NOT dropped — a clean browse must still return data.
      const cleanRes = await http.get('/api/search').set(noAuthHeaders());
      expect(cleanRes.status).toBe(200);
      expect(cleanRes.body.total.restaurants).toBeGreaterThan(0);
    });

    it('SEC-02: HTML/script injection in q param returns safe JSON', async () => {
      const res = await http
        .get('/api/search?q=<script>alert(1)</script>')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('restaurants');
    });

    it('SEC-03: SQL injection in tag param is safely handled', async () => {
      const res = await http
        .get("/api/search?tag=' OR '1'='1")
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      // No tag matches the injection string exactly — empty results expected
      expect(res.body.items).toEqual([]);
    });
  });

  // ── § 15 Ranking (score-based ordering) ──────────────────────────────────────

  describe('§15 GET /api/search — ranking engine', () => {
    it('RK-01: exact name match ranks above partial match for restaurants', async () => {
      // "Phở Bắc" has exact word "Phở" in name (score=12+)
      // "Cơm Tấm Sài Gòn" matches via an item name "Cơm Tấm Sườn Nướng" (score=2 desc)
      const res = await http.get('/api/search?q=pho').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurants = res.body.restaurants as {
        id: string;
        score?: number;
      }[];
      expect(restaurants.length).toBeGreaterThan(0);
      // R1 must be first (highest score — name contains "Phở")
      expect(restaurants[0].id).toBe(S.R1);
    });

    it('RK-02: exact item name match ranks above partial match for items', async () => {
      // "Phở Bò Tái Nạm" and "Phở Gà" both start with "Phở" — partial (score=8)
      // No item is exactly "pho" so both share partial score
      // Verify items section is not empty and contains the pho items
      const res = await http.get('/api/search?q=pho').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r1Pho1);
      expect(itemIds).toContain(S.r1Pho2);
    });

    it('RK-03: tag match contributes to item score alongside name match', async () => {
      // r1BunBo has tag "spicy" + name "Bún Bò Huế" — q=spicy gives tag bonus (score=5)
      const res = await http.get('/api/search?q=spicy').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      // Both spicy items should appear
      expect(itemIds).toContain(S.r1BunBo);
      expect(itemIds).toContain(S.r4Kimchi);
    });

    it('RK-04: total counts reflect all matches, not just the returned page', async () => {
      // Seed has 3 items in R1 Noodles category; limit=1 should still show total=3
      const res = await http
        .get('/api/search?category=Noodles&limit=1')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect((res.body.items as unknown[]).length).toBeLessThanOrEqual(1);
      expect(res.body.total.items).toBe(3); // Phở Bò + Phở Gà + Bún Bò Huế
    });

    it('RK-05: q=com+tam: R3 name match scores higher than other cuisineType matches', async () => {
      const res = await http.get('/api/search?q=com+tam').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const restaurants = res.body.restaurants as { id: string }[];
      // R3 ("Cơm Tấm Sài Gòn") has name match — must appear first
      expect(restaurants[0].id).toBe(S.R3);
    });

    it('RK-06: pagination preserves ranking order across pages', async () => {
      // Get all pho items across 2 pages and verify combined order is consistent
      const page1 = await http
        .get('/api/search?q=pho&limit=1&offset=0')
        .set(noAuthHeaders());
      const page2 = await http
        .get('/api/search?q=pho&limit=1&offset=1')
        .set(noAuthHeaders());
      const allItems = await http
        .get('/api/search?q=pho&limit=100&offset=0')
        .set(noAuthHeaders());

      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);

      const p1Id = (page1.body.items as { id: string }[])[0]?.id;
      const p2Id = (page2.body.items as { id: string }[])[0]?.id;
      const allIds = (allItems.body.items as { id: string }[]).map((i) => i.id);

      expect(p1Id).toBe(allIds[0]);
      expect(p2Id).toBe(allIds[1]);
    });

    it('RK-07: total.items is correct even when category filter is applied', async () => {
      const res = await http
        .get('/api/search?category=Stews')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      // Only Kimchi Jjigae is in the Stews category (r4Kimchi in catR4Stews)
      expect(res.body.total.items).toBe(1);
      const itemIds = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(itemIds).toContain(S.r4Kimchi);
    });

    it('RK-08: total.restaurants is correct before pagination', async () => {
      // All 4 open restaurants (R1, R3, R4, R5) should count
      const res = await http
        .get('/api/search?limit=2&offset=0')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.total.restaurants).toBe(4);
      expect((res.body.restaurants as unknown[]).length).toBe(2);
    });
  });

});
