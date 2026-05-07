import type { Marketplace, ParserDiagnostic, Product } from '@/shared/types';

const DAY = 24 * 60 * 60 * 1000;

export interface ParserHealthBucket {
  ok: number;
  partial: number;
  failed: number;
  total: number;
  /** ok / total, null when total === 0. */
  successRate: number | null;
}

export interface ParserHealthMissingField {
  field: string;
  count: number;
}

export interface ParserHealthRecentFailure {
  id: string;
  marketplace: Marketplace;
  url: string;
  /** URL with the query string masked — diagnostics may be safe but the dashboard masks anyway. */
  displayUrl: string;
  status: 'partial' | 'failed';
  missingFields: string[];
  timestamp: number;
  parserVersion: number;
}

export interface ParserHealthReport {
  /** Snapshot generated time. */
  generatedAt: number;
  /** Stats over the trailing 24 hours, per marketplace. */
  last24h: Record<Marketplace, ParserHealthBucket>;
  /** Stats over the trailing 7 days, per marketplace. */
  last7d: Record<Marketplace, ParserHealthBucket>;
  /** Top missingFields seen in partial/failed diagnostics over the last 7d. */
  topMissingFields7d: ParserHealthMissingField[];
  /** Most recent partial/failed diagnostics, newest first, capped at 50. */
  recentFailures: ParserHealthRecentFailure[];
  /** Distinct active products that currently have parserStatus !== 'ok'. */
  affectedProducts: number;
  /** True when overall 7d success rate < 0.8 → surface a warning banner. */
  alarm: boolean;
}

const RECENT_LIMIT = 50;
const TOP_FIELDS_LIMIT = 10;

export function compute(
  diagnostics: ParserDiagnostic[],
  activeProducts: Product[],
  now: number = Date.now(),
): ParserHealthReport {
  const cutoff24h = now - DAY;
  const cutoff7d = now - 7 * DAY;

  const last24h = emptyByMarketplace();
  const last7d = emptyByMarketplace();
  const fieldCounts = new Map<string, number>();
  const recent: ParserHealthRecentFailure[] = [];

  for (const d of diagnostics) {
    if (d.timestamp >= cutoff7d) tally(last7d[d.marketplace], d.status);
    if (d.timestamp >= cutoff24h) tally(last24h[d.marketplace], d.status);
    if ((d.status === 'partial' || d.status === 'failed') && d.timestamp >= cutoff7d) {
      for (const f of d.missingFields) {
        fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1);
      }
      recent.push({
        id: d.id,
        marketplace: d.marketplace,
        url: d.url,
        displayUrl: maskUrl(d.url),
        status: d.status,
        missingFields: d.missingFields,
        timestamp: d.timestamp,
        parserVersion: d.parserVersion,
      });
    }
  }

  finalizeRates(last24h);
  finalizeRates(last7d);

  recent.sort((a, b) => b.timestamp - a.timestamp);

  const topMissingFields7d = [...fieldCounts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_FIELDS_LIMIT);

  const affectedProducts = activeProducts.filter((p) => p.parserStatus !== 'ok').length;

  // Alarm if overall 7d success rate < 80% AND we have at least 5 samples.
  let totalOk = 0;
  let total = 0;
  for (const v of Object.values(last7d)) {
    totalOk += v.ok;
    total += v.total;
  }
  const alarm = total >= 5 && totalOk / total < 0.8;

  return {
    generatedAt: now,
    last24h,
    last7d,
    topMissingFields7d,
    recentFailures: recent.slice(0, RECENT_LIMIT),
    affectedProducts,
    alarm,
  };
}

function emptyByMarketplace(): Record<Marketplace, ParserHealthBucket> {
  return {
    ozon: empty(),
    wildberries: empty(),
    'yandex-market': empty(),
  };
}

function empty(): ParserHealthBucket {
  return { ok: 0, partial: 0, failed: 0, total: 0, successRate: null };
}

function tally(bucket: ParserHealthBucket, status: ParserDiagnostic['status']): void {
  bucket.total += 1;
  if (status === 'ok') bucket.ok += 1;
  else if (status === 'partial') bucket.partial += 1;
  else bucket.failed += 1;
}

function finalizeRates(buckets: Record<Marketplace, ParserHealthBucket>): void {
  for (const v of Object.values(buckets)) {
    v.successRate = v.total === 0 ? null : v.ok / v.total;
  }
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

export const parserHealth = { compute };
