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
    expect(overview.drops7dCount).toBe(1);
    expect(overview.rises7dCount).toBe(1);
    expect(overview.topDrops7d[0].productId).toBe('a');
    expect(overview.topRises7d[0].productId).toBe('b');
  });

  it('computes potential savings against historical minimum', () => {
    const a = product({ id: 'a', currentPrice: 1500 });
    const points = new Map<string, PricePoint[]>([
      ['a', [pt('a', 1000, 30), pt('a', 1500, 0)]],
    ]);
    const overview = computeOverview({ active: [a], archived: [], pointsByProduct: points }, NOW);
    expect(overview.potentialSavings).toBe(500);
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
