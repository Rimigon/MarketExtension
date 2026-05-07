import { describe, expect, it } from 'vitest';
import { computeOverview } from '@/services/stats';
import type { PricePoint, Product } from '@/shared/types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_700_000_000_000;

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    marketplace: 'ozon',
    url: 'https://example/',
    canonicalUrl: 'https://example/canon',
    sku: '1',
    title: 'Тестовый товар',
    currency: 'RUB',
    currentPrice: 1000,
    oldPrice: null,
    discountPct: null,
    availability: 'in_stock',
    addedAt: NOW - 30 * DAY,
    updatedAt: NOW,
    lastSeenAt: NOW,
    parserVersion: 1,
    parserStatus: 'ok',
    isArchived: false,
    isFavorite: false,
    tags: [],
    collectionIds: [],
    ...over,
  };
}

function pt(productId: string, price: number, daysAgo: number): PricePoint {
  return {
    id: `pt-${productId}-${daysAgo}`,
    productId,
    price,
    oldPrice: null,
    availability: 'in_stock',
    timestamp: NOW - daysAgo * DAY,
    source: 'visit',
  };
}

describe('computeOverview', () => {
  it('counts active, archived and favorites', () => {
    const overview = computeOverview(
      {
        active: [product({ id: 'a', isFavorite: true }), product({ id: 'b' })],
        archived: [product({ id: 'c', isArchived: true })],
        pointsByProduct: new Map(),
      },
      NOW,
    );
    expect(overview.totalActive).toBe(2);
    expect(overview.totalArchived).toBe(1);
    expect(overview.totalFavorites).toBe(1);
  });

  it('finds top drops over 7 days', () => {
    const a = product({ id: 'a', currentPrice: 800 });
    const b = product({ id: 'b', currentPrice: 1500 });
    const points = new Map<string, PricePoint[]>([
      ['a', [pt('a', 1000, 10), pt('a', 1000, 5), pt('a', 800, 0)]],
      ['b', [pt('b', 1000, 10), pt('b', 1500, 0)]],
    ]);
    const overview = computeOverview({ active: [a, b], archived: [], pointsByProduct: points }, NOW);
    expect(overview.dropsCount).toBe(1);
    expect(overview.risesCount).toBe(1);
    expect(overview.topDrops[0].productId).toBe('a');
    expect(overview.topRises[0].productId).toBe('b');
  });

  it('computes potential savings against historical minimum', () => {
    const a = product({ id: 'a', currentPrice: 1500 });
    const points = new Map<string, PricePoint[]>([
      ['a', [pt('a', 1000, 30), pt('a', 1500, 0)]],
    ]);
    const overview = computeOverview({ active: [a], archived: [], pointsByProduct: points }, NOW);
    expect(overview.potentialSavings).toBe(500);
  });

  it('honors a custom period for top movers', () => {
    const a = product({ id: 'a', currentPrice: 800 });
    const points = new Map<string, PricePoint[]>([
      ['a', [pt('a', 1000, 60), pt('a', 1000, 5), pt('a', 800, 0)]],
    ]);
    // 7-day period: ref is at 5d (price 1000) — drop registered.
    const o7 = computeOverview({ active: [a], archived: [], pointsByProduct: points }, NOW, { period: 7 });
    expect(o7.dropsCount).toBe(1);
    expect(o7.period).toBe(7);
    // 90-day period: ref is at 60d (price 1000) — same drop registered.
    const o90 = computeOverview({ active: [a], archived: [], pointsByProduct: points }, NOW, { period: 90 });
    expect(o90.dropsCount).toBe(1);
    expect(o90.period).toBe(90);
  });

  it('flags products near the historical minimum', () => {
    const cheap = product({ id: 'cheap', currentPrice: 1010 }); // 1% above min 1000
    const farFromMin = product({ id: 'far', currentPrice: 1500 }); // 50% above min
    const points = new Map<string, PricePoint[]>([
      ['cheap', [pt('cheap', 1000, 30), pt('cheap', 1010, 0)]],
      ['far', [pt('far', 1000, 30), pt('far', 1500, 0)]],
    ]);
    const overview = computeOverview(
      { active: [cheap, farFromMin], archived: [], pointsByProduct: points },
      NOW,
    );
    expect(overview.nearMinimum).toHaveLength(1);
    expect(overview.nearMinimum[0].productId).toBe('cheap');
    expect(overview.nearMinimum[0].distancePct).toBeCloseTo(0.01);
  });

  it('flags products close to (or below) the user goal', () => {
    const reached = product({
      id: 'reached',
      currentPrice: 950,
      goal: { targetPrice: 1000 },
    });
    const close = product({
      id: 'close',
      currentPrice: 1030,
      goal: { targetPrice: 1000 },
    });
    const farFromGoal = product({
      id: 'far',
      currentPrice: 2000,
      goal: { targetPrice: 1000 },
    });
    const noGoal = product({ id: 'no-goal', currentPrice: 100 });
    const overview = computeOverview(
      {
        active: [reached, close, farFromGoal, noGoal],
        archived: [],
        pointsByProduct: new Map(),
      },
      NOW,
    );
    const ids = overview.nearGoal.map((p) => p.productId);
    expect(ids).toContain('reached');
    expect(ids).toContain('close');
    expect(ids).not.toContain('far');
    expect(ids).not.toContain('no-goal');
    // Reached one comes first (negative distance).
    expect(overview.nearGoal[0].productId).toBe('reached');
    expect(overview.nearGoal[0].distancePct).toBeLessThan(0);
  });

  it('summarizes parser health from diagnostics', () => {
    const diagnostics = [
      { id: '1', marketplace: 'ozon' as const, parserVersion: 1, status: 'ok' as const, url: '', missingFields: [], timestamp: NOW - 1 * HOUR },
      { id: '2', marketplace: 'ozon' as const, parserVersion: 1, status: 'failed' as const, url: '', missingFields: [], timestamp: NOW - 2 * HOUR },
      { id: '3', marketplace: 'wildberries' as const, parserVersion: 1, status: 'ok' as const, url: '', missingFields: [], timestamp: NOW - 1 * DAY },
      { id: 'old', marketplace: 'ozon' as const, parserVersion: 1, status: 'failed' as const, url: '', missingFields: [], timestamp: NOW - 30 * DAY },
    ];
    const overview = computeOverview(
      {
        active: [],
        archived: [],
        pointsByProduct: new Map(),
        diagnostics,
      },
      NOW,
    );
    expect(overview.parserHealth.byMarketplace.ozon.total).toBe(2);
    expect(overview.parserHealth.byMarketplace.ozon.failed).toBe(1);
    expect(overview.parserHealth.byMarketplace.wildberries.ok).toBe(1);
    expect(overview.parserHealth.failures7d).toBe(1); // old diag excluded
    // 2 ok / 3 total in window.
    expect(overview.parserHealth.overallSuccessRate).toBeCloseTo(2 / 3);
  });

  it('counts stale products older than 7 days', () => {
    const overview = computeOverview(
      {
        active: [
          product({ id: 'fresh', updatedAt: NOW - 1 * DAY }),
          product({ id: 'stale', updatedAt: NOW - 14 * DAY }),
        ],
        archived: [],
        pointsByProduct: new Map(),
      },
      NOW,
    );
    expect(overview.staleCount).toBe(1);
  });
});
