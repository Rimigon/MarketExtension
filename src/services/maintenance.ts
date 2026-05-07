import type { ParserDiagnostic, PricePoint } from '@/shared/types';

/**
 * IndexedDB hygiene. The extension is local-first, so without compaction the
 * database grows linearly with every refresh: at hourly cadence, each product
 * accumulates ~8.7k points/year. Two routines keep things tame:
 *
 *  • `compactPricePoints` — for days older than RAW_TTL_DAYS, replace the
 *    intra-day stream with at most two sentinel points: the day-min (preserves
 *    `historicalLow` triggers and `minPriceForProduct`) and the day-close
 *    (preserves the trend curve when bucketed). Recent days are untouched so
 *    the chart stays high-resolution where the user looks.
 *  • `purgeOldDiagnostics` — drop parser-failure rows older than
 *    DIAGNOSTICS_TTL_DAYS. Diagnostics are debugging telemetry, not user data.
 *
 * Both functions are pure (no DB) here — the background driver wires them to
 * Dexie. This keeps the logic testable on synthetic inputs without
 * fake-indexeddb gymnastics.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const RAW_TTL_DAYS = 30;
export const DIAGNOSTICS_TTL_DAYS = 30;

export interface CompactionPlan {
  /** Points to keep (sentinels for old days + everything within RAW_TTL_DAYS). */
  keepIds: Set<string>;
  /** Points to delete. Disjoint from keepIds. */
  deleteIds: Set<string>;
}

/**
 * Decide which points stay and which get dropped. Sentinel selection per old
 * day: keep the day-min and the day-close. If they coincide, keep one. If
 * there's only one point in the day, keep it as-is.
 *
 * `now` parameter is injected for testability.
 */
export function planCompaction(points: PricePoint[], now: number = Date.now()): CompactionPlan {
  const cutoff = now - RAW_TTL_DAYS * DAY;
  const keepIds = new Set<string>();
  const deleteIds = new Set<string>();

  // Group by [productId, dayStart]. Recent days (>= cutoff start of day) are
  // exempt — we keep every raw point.
  const byBucket = new Map<string, PricePoint[]>();
  for (const p of points) {
    if (p.timestamp >= cutoff) {
      keepIds.add(p.id);
      continue;
    }
    const day = startOfDay(p.timestamp);
    const key = `${p.productId}|${day}`;
    const arr = byBucket.get(key);
    if (arr) arr.push(p);
    else byBucket.set(key, [p]);
  }

  for (const bucket of byBucket.values()) {
    if (bucket.length === 1) {
      keepIds.add(bucket[0].id);
      continue;
    }
    const sorted = [...bucket].sort((a, b) => a.timestamp - b.timestamp);
    let minPoint = sorted[0];
    for (const p of sorted) {
      if (p.price < minPoint.price) minPoint = p;
    }
    const closePoint = sorted[sorted.length - 1];
    keepIds.add(minPoint.id);
    keepIds.add(closePoint.id);
    for (const p of sorted) {
      if (!keepIds.has(p.id)) deleteIds.add(p.id);
    }
  }

  return { keepIds, deleteIds };
}

export interface DiagnosticsPurgePlan {
  deleteIds: Set<string>;
}

export function planDiagnosticsPurge(
  diagnostics: ParserDiagnostic[],
  now: number = Date.now(),
): DiagnosticsPurgePlan {
  const cutoff = now - DIAGNOSTICS_TTL_DAYS * DAY;
  const deleteIds = new Set<string>();
  for (const d of diagnostics) {
    if (d.timestamp < cutoff) deleteIds.add(d.id);
  }
  return { deleteIds };
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const maintenance = {
  planCompaction,
  planDiagnosticsPurge,
  RAW_TTL_DAYS,
  DIAGNOSTICS_TTL_DAYS,
};
