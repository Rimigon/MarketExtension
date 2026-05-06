import { describe, expect, it } from 'vitest';
import { recommend } from '@/services/recommendation';
import type { PricePoint } from '@/shared/types';

function pt(price: number, ts: number): PricePoint {
  return {
    id: `p-${ts}`,
    productId: 'prod-1',
    price,
    oldPrice: null,
    availability: 'in_stock',
    timestamp: ts,
    source: 'visit',
  };
}

describe('recommend', () => {
  it('returns no_data for missing price', () => {
    const r = recommend(null, [pt(100, 1), pt(110, 2), pt(120, 3), pt(130, 4), pt(140, 5)]);
    expect(r.verdict).toBe('no_data');
  });

  it('returns no_data when fewer than 5 points', () => {
    const r = recommend(100, [pt(100, 1), pt(110, 2), pt(120, 3)]);
    expect(r.verdict).toBe('no_data');
    expect(r.sampleSize).toBe(3);
  });

  it('says buy_now when current is at the historical bottom', () => {
    const points = Array.from({ length: 10 }, (_, i) => pt(100 + i * 10, i + 1));
    const r = recommend(100, points);
    expect(r.verdict).toBe('buy_now');
    expect(r.percentile).toBeLessThanOrEqual(0.1);
    expect(r.min).toBe(100);
  });

  it('says good_price in the lower-mid range', () => {
    const points = [pt(100, 1), pt(110, 2), pt(120, 3), pt(130, 4), pt(140, 5), pt(150, 6), pt(160, 7), pt(170, 8), pt(180, 9), pt(190, 10)];
    const r = recommend(120, points);
    expect(r.verdict).toBe('good_price');
  });

  it('says fair_price near the median', () => {
    const points = Array.from({ length: 11 }, (_, i) => pt(100 + i * 10, i + 1));
    // current = median = 150 → percentile ~ 0.55
    const r = recommend(150, points);
    expect(r.verdict).toBe('fair_price');
  });

  it('says overpriced when above 70th percentile', () => {
    const points = Array.from({ length: 10 }, (_, i) => pt(100 + i * 10, i + 1));
    const r = recommend(195, points);
    expect(r.verdict).toBe('overpriced');
  });
});
