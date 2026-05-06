import { describe, expect, it } from 'vitest';
import { bucketByDay, compute, rangeCutoff } from '@/services/price-history';
import type { PricePoint } from '@/shared/types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function point(price: number, timestamp: number, overrides: Partial<PricePoint> = {}): PricePoint {
  return {
    id: `p-${timestamp}-${price}`,
    productId: 'prod-1',
    price,
    oldPrice: null,
    availability: 'in_stock',
    timestamp,
    source: 'visit',
    ...overrides,
  };
}

describe('priceHistory.compute', () => {
  it('returns nulls for an empty series', () => {
    const a = compute([]);
    expect(a.count).toBe(0);
    expect(a.current).toBeNull();
    expect(a.min).toBeNull();
    expect(a.max).toBeNull();
    expect(a.avg).toBeNull();
    expect(a.currentVsAvg).toBeNull();
    expect(a.lastChange).toBeNull();
    expect(a.delta24h).toBeNull();
    expect(a.delta7d).toBeNull();
    expect(a.delta30d).toBeNull();
  });

  it('handles a single point — avg equals price, deltas are null', () => {
    const now = 1_700_000_000_000;
    const a = compute([point(1000, now - 1 * HOUR)], now);
    expect(a.count).toBe(1);
    expect(a.current).toBe(1000);
    expect(a.min).toBe(1000);
    expect(a.max).toBe(1000);
    expect(a.avg).toBe(1000);
    expect(a.currentVsAvg).toBe(0);
    expect(a.lastChange).toBeNull();
    expect(a.delta24h).toBeNull();
  });

  it('computes min/max with their timestamps', () => {
    const now = 1_700_000_000_000;
    const a = compute(
      [
        point(1000, now - 30 * DAY),
        point(800, now - 10 * DAY),
        point(1200, now - 2 * DAY),
        point(900, now - 1 * HOUR),
      ],
      now,
    );
    expect(a.min).toBe(800);
    expect(a.minAt).toBe(now - 10 * DAY);
    expect(a.max).toBe(1200);
    expect(a.maxAt).toBe(now - 2 * DAY);
    expect(a.current).toBe(900);
  });

  it('computes lastChange (current minus prior point)', () => {
    const now = 1_700_000_000_000;
    const a = compute([point(1000, now - 2 * DAY), point(900, now - 1 * HOUR)], now);
    expect(a.lastChange).toBe(-100);
  });

  it('time-weighted avg leans towards long-held prices', () => {
    const now = 1_700_000_000_000;
    // 1000 для большей части окна (10 дней), затем 500 за последний час → среднее ближе к 1000.
    const a = compute(
      [point(1000, now - 10 * DAY), point(500, now - 1 * HOUR)],
      now,
    );
    expect(a.avg).not.toBeNull();
    expect(a.avg!).toBeGreaterThan(900);
    expect(a.avg!).toBeLessThan(1000);
  });

  it('delta7d uses an out-of-range earliest point as fallback when series is younger than 7d', () => {
    const now = 1_700_000_000_000;
    const a = compute([point(1000, now - 2 * DAY), point(800, now - 1 * HOUR)], now);
    expect(a.delta7d).not.toBeNull();
    expect(a.delta7d!.refPrice).toBe(1000);
    expect(a.delta7d!.abs).toBe(-200);
  });

  it('delta24h picks the latest point at or before the cutoff', () => {
    const now = 1_700_000_000_000;
    const a = compute(
      [
        point(1500, now - 5 * DAY), // ref candidate (older than 24h)
        point(1300, now - 36 * HOUR), // newer, but still > 24h ago — better ref
        point(1200, now - 12 * HOUR), // inside 24h window — not ref
        point(1100, now - 1 * HOUR), // current
      ],
      now,
    );
    expect(a.delta24h).not.toBeNull();
    expect(a.delta24h!.refPrice).toBe(1300);
    expect(a.delta24h!.abs).toBe(-200);
  });

  it('currentVsAvg is positive when current is above the average', () => {
    const now = 1_700_000_000_000;
    const a = compute(
      [point(800, now - 30 * DAY), point(800, now - 5 * DAY), point(1200, now - 1 * HOUR)],
      now,
    );
    expect(a.currentVsAvg).not.toBeNull();
    expect(a.currentVsAvg!).toBeGreaterThan(0);
  });
});

describe('priceHistory.bucketByDay', () => {
  it('returns empty for empty input', () => {
    expect(bucketByDay([])).toEqual([]);
  });

  it('groups intra-day points into one bucket with min/max/close', () => {
    const day = new Date('2025-01-15T00:00:00').getTime();
    const buckets = bucketByDay([
      point(1000, day + 9 * HOUR),
      point(950, day + 12 * HOUR),
      point(1100, day + 18 * HOUR),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].min).toBe(950);
    expect(buckets[0].max).toBe(1100);
    expect(buckets[0].close).toBe(1100);
    expect(buckets[0].count).toBe(3);
  });

  it('sorts buckets ascending and keeps gaps as missing days', () => {
    const d1 = new Date('2025-01-15T12:00:00').getTime();
    const d3 = new Date('2025-01-17T12:00:00').getTime();
    const buckets = bucketByDay([point(1000, d3), point(900, d1)]);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].ts).toBeLessThan(buckets[1].ts);
  });
});

describe('priceHistory.rangeCutoff', () => {
  it('all → 0 (open-ended)', () => {
    expect(rangeCutoff('all')).toBe(0);
  });

  it('7d / 30d / 90d return strictly decreasing cutoffs from now', () => {
    const now = 1_700_000_000_000;
    const c7 = rangeCutoff('7d', now);
    const c30 = rangeCutoff('30d', now);
    const c90 = rangeCutoff('90d', now);
    expect(c7).toBeGreaterThan(c30);
    expect(c30).toBeGreaterThan(c90);
    expect(now - c7).toBe(7 * DAY);
  });
});
