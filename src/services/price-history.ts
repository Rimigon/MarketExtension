import type { PricePoint } from '@/shared/types';

export interface PriceHistoryAggregates {
  /** Number of points considered. */
  count: number;
  /** Latest price (most recent point). */
  current: number | null;
  /** Lowest price ever observed. */
  min: number | null;
  /** Highest price ever observed. */
  max: number | null;
  /** Time-weighted average price. Falls back to arithmetic mean for ≤ 1 point. */
  avg: number | null;
  /** Ratio current/avg − 1 (0 = ровно средняя). null если нет истории. */
  currentVsAvg: number | null;
  /** Difference current − previous point. null если точек < 2. */
  lastChange: number | null;
  /** Absolute drops vs N hours/days ago. null когда нет данных за период. */
  delta24h: PriceDelta | null;
  delta7d: PriceDelta | null;
  delta30d: PriceDelta | null;
  /** Timestamps of min/max occurrences (latest matching). */
  minAt: number | null;
  maxAt: number | null;
}

export interface PriceDelta {
  /** abs change (current − ref). */
  abs: number;
  /** ratio change (current − ref) / ref. */
  pct: number;
  /** Reference price used for the delta. */
  refPrice: number;
  /** Reference timestamp. */
  refAt: number;
}

export interface DailyBucket {
  /** Day-start timestamp (local 00:00). */
  ts: number;
  /** Min price observed during the day. */
  min: number;
  /** Max price observed during the day. */
  max: number;
  /** Closing price (last point of the day). */
  close: number;
  /** Number of raw points within the bucket. */
  count: number;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Compute aggregate statistics over a sequence of price points. Input does not
 * need to be pre-sorted; we sort by timestamp ascending here.
 */
export function compute(points: PricePoint[], now: number = Date.now()): PriceHistoryAggregates {
  if (points.length === 0) {
    return {
      count: 0,
      current: null,
      min: null,
      max: null,
      avg: null,
      currentVsAvg: null,
      lastChange: null,
      delta24h: null,
      delta7d: null,
      delta30d: null,
      minAt: null,
      maxAt: null,
    };
  }

  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const current = sorted[sorted.length - 1].price;

  let min = sorted[0].price;
  let minAt = sorted[0].timestamp;
  let max = sorted[0].price;
  let maxAt = sorted[0].timestamp;

  for (const p of sorted) {
    if (p.price < min) {
      min = p.price;
      minAt = p.timestamp;
    }
    if (p.price > max) {
      max = p.price;
      maxAt = p.timestamp;
    }
  }

  const avg = timeWeightedAverage(sorted, now);
  const currentVsAvg = avg && avg > 0 ? current / avg - 1 : null;

  const lastChange =
    sorted.length >= 2 ? current - sorted[sorted.length - 2].price : null;

  return {
    count: sorted.length,
    current,
    min,
    max,
    avg,
    currentVsAvg,
    lastChange,
    delta24h: deltaSince(sorted, now - DAY, current),
    delta7d: deltaSince(sorted, now - 7 * DAY, current),
    delta30d: deltaSince(sorted, now - 30 * DAY, current),
    minAt,
    maxAt,
  };
}

function deltaSince(
  sortedAsc: PricePoint[],
  cutoff: number,
  current: number,
): PriceDelta | null {
  // Find the latest point at or before cutoff. If everything is newer than cutoff
  // (i.e., the series only started recently), fall back to the earliest available point —
  // but only if we have ≥ 2 points; with a single point we don't know what was before it.
  let ref: PricePoint | null = null;
  for (const p of sortedAsc) {
    if (p.timestamp <= cutoff) ref = p;
    else break;
  }
  if (!ref) {
    if (sortedAsc.length < 2) return null;
    ref = sortedAsc[0];
  }
  if (ref.price <= 0) return null;
  const abs = current - ref.price;
  const pct = abs / ref.price;
  return { abs, pct, refPrice: ref.price, refAt: ref.timestamp };
}

/**
 * Time-weighted average: integrate price·dt across the series and divide by total span.
 * For a single point, returns the point's price.
 */
function timeWeightedAverage(sortedAsc: PricePoint[], now: number): number {
  if (sortedAsc.length === 1) return sortedAsc[0].price;
  let weightedSum = 0;
  let totalSpan = 0;
  for (let i = 0; i < sortedAsc.length - 1; i++) {
    const span = sortedAsc[i + 1].timestamp - sortedAsc[i].timestamp;
    if (span <= 0) continue;
    weightedSum += sortedAsc[i].price * span;
    totalSpan += span;
  }
  // Tail: extend the last point to "now".
  const tailSpan = Math.max(0, now - sortedAsc[sortedAsc.length - 1].timestamp);
  if (tailSpan > 0) {
    weightedSum += sortedAsc[sortedAsc.length - 1].price * tailSpan;
    totalSpan += tailSpan;
  }
  if (totalSpan === 0) {
    // All points share the same timestamp — just average the prices.
    return sortedAsc.reduce((s, p) => s + p.price, 0) / sortedAsc.length;
  }
  return weightedSum / totalSpan;
}

/**
 * Bucket points into daily OHLC-ish summaries (min / max / close per local day).
 * Returns ascending. If no points fall on a given day, that day is omitted —
 * the chart should treat it as a gap rather than a zero.
 */
export function bucketByDay(points: PricePoint[]): DailyBucket[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const buckets = new Map<number, DailyBucket>();
  for (const p of sorted) {
    const day = startOfDay(p.timestamp);
    const existing = buckets.get(day);
    if (!existing) {
      buckets.set(day, { ts: day, min: p.price, max: p.price, close: p.price, count: 1 });
    } else {
      existing.min = Math.min(existing.min, p.price);
      existing.max = Math.max(existing.max, p.price);
      existing.close = p.price; // sorted ascending → last assignment wins
      existing.count += 1;
    }
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type Range = '7d' | '30d' | '90d' | 'all';

export function rangeCutoff(range: Range, now: number = Date.now()): number {
  switch (range) {
    case '7d':
      return now - 7 * DAY;
    case '30d':
      return now - 30 * DAY;
    case '90d':
      return now - 90 * DAY;
    case 'all':
      return 0;
  }
}

export const priceHistory = {
  compute,
  bucketByDay,
  rangeCutoff,
};
