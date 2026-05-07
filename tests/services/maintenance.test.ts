import { describe, expect, it } from 'vitest';
import {
  planCompaction,
  planDiagnosticsPurge,
  RAW_TTL_DAYS,
  DIAGNOSTICS_TTL_DAYS,
} from '@/services/maintenance';
import type { ParserDiagnostic, PricePoint } from '@/shared/types';

const DAY = 24 * 60 * 60 * 1000;

function makePoint(args: { id: string; productId: string; price: number; timestamp: number }): PricePoint {
  return {
    id: args.id,
    productId: args.productId,
    price: args.price,
    oldPrice: null,
    availability: 'in_stock',
    timestamp: args.timestamp,
    source: 'visit',
  };
}

describe('planCompaction', () => {
  const NOW = new Date('2026-05-07T12:00:00').getTime();

  it('keeps every point within RAW_TTL_DAYS untouched', () => {
    const recent: PricePoint[] = [];
    for (let i = 0; i < 50; i++) {
      recent.push(
        makePoint({
          id: `r${i}`,
          productId: 'p1',
          price: 1000 + i,
          timestamp: NOW - i * 60 * 60 * 1000, // hours back
        }),
      );
    }
    const plan = planCompaction(recent, NOW);
    expect(plan.deleteIds.size).toBe(0);
    expect(plan.keepIds.size).toBe(recent.length);
  });

  it('keeps day-min and day-close for old days, deletes the rest', () => {
    const oldDay = NOW - (RAW_TTL_DAYS + 5) * DAY;
    const dayBase = new Date(oldDay);
    dayBase.setHours(8, 0, 0, 0);
    const start = dayBase.getTime();
    const points: PricePoint[] = [
      makePoint({ id: 'a', productId: 'p1', price: 1500, timestamp: start }),
      makePoint({ id: 'b', productId: 'p1', price: 1200, timestamp: start + 1000 }), // min
      makePoint({ id: 'c', productId: 'p1', price: 1300, timestamp: start + 2000 }),
      makePoint({ id: 'd', productId: 'p1', price: 1400, timestamp: start + 3000 }), // close
    ];
    const plan = planCompaction(points, NOW);
    expect(plan.keepIds.has('b')).toBe(true); // min
    expect(plan.keepIds.has('d')).toBe(true); // close
    expect(plan.deleteIds.has('a')).toBe(true);
    expect(plan.deleteIds.has('c')).toBe(true);
  });

  it('keeps a single point in an old day as-is', () => {
    const oldTs = NOW - (RAW_TTL_DAYS + 100) * DAY;
    const points: PricePoint[] = [
      makePoint({ id: 'lonely', productId: 'p1', price: 999, timestamp: oldTs }),
    ];
    const plan = planCompaction(points, NOW);
    expect(plan.keepIds.has('lonely')).toBe(true);
    expect(plan.deleteIds.size).toBe(0);
  });

  it('groups by product — same day across products is independent', () => {
    const oldTs = NOW - (RAW_TTL_DAYS + 5) * DAY;
    const day = new Date(oldTs);
    day.setHours(10, 0, 0, 0);
    const t = day.getTime();
    const points: PricePoint[] = [
      makePoint({ id: 'p1a', productId: 'p1', price: 100, timestamp: t }),
      makePoint({ id: 'p1b', productId: 'p1', price: 90, timestamp: t + 1000 }),
      makePoint({ id: 'p2a', productId: 'p2', price: 200, timestamp: t }),
      makePoint({ id: 'p2b', productId: 'p2', price: 250, timestamp: t + 1000 }),
    ];
    const plan = planCompaction(points, NOW);
    // p1: min=90 (p1b), close=p1b → just one survivor
    expect(plan.keepIds.has('p1b')).toBe(true);
    expect(plan.deleteIds.has('p1a')).toBe(true);
    // p2: min=200 (p2a), close=p2b → both survive
    expect(plan.keepIds.has('p2a')).toBe(true);
    expect(plan.keepIds.has('p2b')).toBe(true);
  });

  it('handles min === close (single survivor)', () => {
    const oldTs = NOW - (RAW_TTL_DAYS + 5) * DAY;
    const day = new Date(oldTs);
    day.setHours(10, 0, 0, 0);
    const t = day.getTime();
    const points: PricePoint[] = [
      makePoint({ id: 'a', productId: 'p1', price: 200, timestamp: t }),
      makePoint({ id: 'b', productId: 'p1', price: 150, timestamp: t + 1000 }), // min AND close
    ];
    const plan = planCompaction(points, NOW);
    expect(plan.keepIds.has('b')).toBe(true);
    expect(plan.deleteIds.has('a')).toBe(true);
  });
});

describe('planDiagnosticsPurge', () => {
  const NOW = new Date('2026-05-07T12:00:00').getTime();

  function diag(id: string, daysAgo: number): ParserDiagnostic {
    return {
      id,
      marketplace: 'ozon',
      parserVersion: 1,
      status: 'failed',
      url: 'https://ozon.ru/x',
      missingFields: [],
      timestamp: NOW - daysAgo * DAY,
    };
  }

  it('drops anything older than DIAGNOSTICS_TTL_DAYS', () => {
    const items = [
      diag('keep1', 1),
      diag('keep2', DIAGNOSTICS_TTL_DAYS - 1),
      diag('drop1', DIAGNOSTICS_TTL_DAYS + 1),
      diag('drop2', 90),
    ];
    const plan = planDiagnosticsPurge(items, NOW);
    expect(plan.deleteIds.has('drop1')).toBe(true);
    expect(plan.deleteIds.has('drop2')).toBe(true);
    expect(plan.deleteIds.has('keep1')).toBe(false);
    expect(plan.deleteIds.has('keep2')).toBe(false);
  });
});
