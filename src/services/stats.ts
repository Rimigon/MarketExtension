import type { Marketplace, ParserDiagnostic, ParserStatus, PricePoint, Product } from '@/shared/types';

export type StatsPeriodDays = 7 | 30 | 90;

export interface ProductMover {
  productId: string;
  title: string;
  marketplace: Marketplace;
  imageUrl?: string;
  current: number;
  prev: number;
  abs: number;
  pct: number;
  /** Daily-close prices for the trailing 30 days (oldest → newest). Empty when there's no history. */
  spark: number[];
}

export interface NearMinimumProduct {
  productId: string;
  title: string;
  marketplace: Marketplace;
  imageUrl?: string;
  current: number;
  min: number;
  /** Distance in percent above the historical minimum (0 = exactly at min, 0.05 = 5% above). */
  distancePct: number;
  spark: number[];
}

export interface NearGoalProduct {
  productId: string;
  title: string;
  marketplace: Marketplace;
  imageUrl?: string;
  current: number;
  target: number;
  /** Distance in percent above the target (negative = already at/below target). */
  distancePct: number;
}

export interface ParserHealthSummary {
  /** Successful parses in the trailing 7 days, per marketplace. */
  byMarketplace: Record<Marketplace, { ok: number; partial: number; failed: number; total: number }>;
  /** Combined success rate across all marketplaces over the trailing 7 days (0..1). null when no data. */
  overallSuccessRate: number | null;
  /** Number of distinct failed parses in the last 7 days. */
  failures7d: number;
  /** True when overall 7d success rate < 0.8 with ≥ 5 samples — surfaces a banner. */
  alarm: boolean;
}

export interface StatsOverview {
  totalActive: number;
  totalArchived: number;
  totalFavorites: number;
  byMarketplace: Record<Marketplace, number>;
  /** Active period the topMovers / dropsCount / risesCount are computed over. */
  period: StatsPeriodDays;
  /** Сколько товаров подешевело за выбранный период. */
  dropsCount: number;
  /** Сколько товаров подорожало за выбранный период. */
  risesCount: number;
  /** Топ-5 падений за период (по pct). */
  topDrops: ProductMover[];
  /** Топ-5 ростов за период (по pct). */
  topRises: ProductMover[];
  /** Товары, текущая цена которых в пределах 5% от исторического минимума. Топ-5 по близости. */
  nearMinimum: NearMinimumProduct[];
  /** Товары с целевой ценой, до которой осталось ≤ 5%. Включая уже достигнутые (distancePct ≤ 0). */
  nearGoal: NearGoalProduct[];
  /** Средняя действующая скидка по активным товарам, у которых есть discountPct. 0..1 */
  avgDiscount: number | null;
  /** Сумма sum(min(allTime) − current)+ — потенциал сэкономленного при покупке на минимуме. */
  potentialSavings: number;
  /** Товары, которые не обновлялись > 7 дней. */
  staleCount: number;
  /** Сколько точек истории всего. */
  pricePointsCount: number;
  /** Сводная статистика парсеров за последние 7 дней. */
  parserHealth: ParserHealthSummary;
}

const DAY = 24 * 60 * 60 * 1000;
const SPARK_DAYS = 30;
const NEAR_MIN_THRESHOLD = 0.05;
const NEAR_GOAL_THRESHOLD = 0.05;

export interface StatsInput {
  active: Product[];
  archived: Product[];
  /** Map productId → его price points (любого размера, не обязательно отсортированные). */
  pointsByProduct: Map<string, PricePoint[]>;
  /** Diagnostics for the trailing parser-health window. Caller should pass last ~14 days. */
  diagnostics?: ParserDiagnostic[];
}

export interface StatsOptions {
  /** Trailing window in days for top-movers and counts. Default 7. */
  period?: StatsPeriodDays;
}

export function computeOverview(
  input: StatsInput,
  nowOrOptions: number | StatsOptions = Date.now(),
  legacyOptions?: StatsOptions,
): StatsOverview {
  // Backwards-compat: original signature was (input, now). Accept both.
  let now: number;
  let options: StatsOptions;
  if (typeof nowOrOptions === 'number') {
    now = nowOrOptions;
    options = legacyOptions ?? {};
  } else {
    now = Date.now();
    options = nowOrOptions;
  }
  const period: StatsPeriodDays = options.period ?? 7;
  const { active, archived, pointsByProduct, diagnostics = [] } = input;

  const byMarketplace: Record<Marketplace, number> = {
    ozon: 0,
    wildberries: 0,
    'yandex-market': 0,
  };
  for (const p of active) byMarketplace[p.marketplace] += 1;

  const periodCutoff = now - period * DAY;
  const movers: ProductMover[] = [];
  let drops = 0;
  let rises = 0;
  let pricePointsCount = 0;

  for (const product of active) {
    const points = pointsByProduct.get(product.id) ?? [];
    pricePointsCount += points.length;
    if (points.length < 2) continue;
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const current = sorted[sorted.length - 1].price;
    let ref: PricePoint | null = null;
    for (const pt of sorted) {
      if (pt.timestamp <= periodCutoff) ref = pt;
      else break;
    }
    if (!ref) ref = sorted[0];
    if (ref.price <= 0) continue;
    const abs = current - ref.price;
    if (abs === 0) continue;
    if (abs < 0) drops += 1;
    else rises += 1;
    movers.push({
      productId: product.id,
      title: product.title,
      marketplace: product.marketplace,
      imageUrl: product.imageUrl,
      current,
      prev: ref.price,
      abs,
      pct: abs / ref.price,
      spark: dailyCloseSpark(sorted, now, SPARK_DAYS),
    });
  }

  const topDrops = movers
    .filter((m) => m.abs < 0)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 5);
  const topRises = movers
    .filter((m) => m.abs > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  const withDiscount = active.filter((p) => p.discountPct != null && p.discountPct > 0);
  const avgDiscount =
    withDiscount.length === 0
      ? null
      : withDiscount.reduce((s, p) => s + (p.discountPct ?? 0), 0) / withDiscount.length / 100;

  let potentialSavings = 0;
  const nearMinimum: NearMinimumProduct[] = [];
  for (const product of active) {
    if (product.currentPrice == null) continue;
    const points = pointsByProduct.get(product.id) ?? [];
    if (points.length === 0) continue;
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const minPrice = Math.min(...sorted.map((p) => p.price));
    const diff = product.currentPrice - minPrice;
    if (diff > 0) potentialSavings += diff;
    if (minPrice > 0) {
      const distance = (product.currentPrice - minPrice) / minPrice;
      if (distance <= NEAR_MIN_THRESHOLD && sorted.length >= 2) {
        nearMinimum.push({
          productId: product.id,
          title: product.title,
          marketplace: product.marketplace,
          imageUrl: product.imageUrl,
          current: product.currentPrice,
          min: minPrice,
          distancePct: Math.max(0, distance),
          spark: dailyCloseSpark(sorted, now, SPARK_DAYS),
        });
      }
    }
  }
  nearMinimum.sort((a, b) => a.distancePct - b.distancePct);
  const nearMinimumTop = nearMinimum.slice(0, 5);

  const nearGoal: NearGoalProduct[] = [];
  for (const product of active) {
    const target = product.goal?.targetPrice;
    if (target == null || target <= 0 || product.currentPrice == null) continue;
    const distance = (product.currentPrice - target) / target;
    if (distance <= NEAR_GOAL_THRESHOLD) {
      nearGoal.push({
        productId: product.id,
        title: product.title,
        marketplace: product.marketplace,
        imageUrl: product.imageUrl,
        current: product.currentPrice,
        target,
        distancePct: distance,
      });
    }
  }
  nearGoal.sort((a, b) => a.distancePct - b.distancePct);
  const nearGoalTop = nearGoal.slice(0, 5);

  const staleCutoff = now - 7 * DAY;
  const staleCount = active.filter((p) => p.updatedAt < staleCutoff).length;

  const parserHealth = computeParserHealth(diagnostics, now);

  return {
    totalActive: active.length,
    totalArchived: archived.length,
    totalFavorites: active.filter((p) => p.isFavorite).length,
    byMarketplace,
    period,
    dropsCount: drops,
    risesCount: rises,
    topDrops,
    topRises,
    nearMinimum: nearMinimumTop,
    nearGoal: nearGoalTop,
    avgDiscount,
    potentialSavings: Math.round(potentialSavings),
    staleCount,
    pricePointsCount,
    parserHealth,
  };
}

/**
 * Reduce a sorted price-point series to per-day closing prices over the last
 * `days` days (oldest → newest). Days with no points carry the previous day's
 * close so the sparkline doesn't flat-line to zero.
 */
function dailyCloseSpark(sortedAsc: PricePoint[], now: number, days: number): number[] {
  if (sortedAsc.length === 0) return [];
  const startDay = startOfDay(now - (days - 1) * DAY);
  const buckets = new Map<number, number>();
  for (const p of sortedAsc) {
    const day = startOfDay(p.timestamp);
    if (day < startDay) continue;
    buckets.set(day, p.price); // sorted ascending → last write wins (close)
  }
  // Find the last point at or before startDay to seed the carry-forward.
  let lastBefore: number | null = null;
  for (const p of sortedAsc) {
    if (startOfDay(p.timestamp) < startDay) lastBefore = p.price;
    else break;
  }
  const result: number[] = [];
  let carry: number | null = lastBefore;
  for (let i = 0; i < days; i++) {
    const day = startDay + i * DAY;
    if (buckets.has(day)) {
      carry = buckets.get(day)!;
    }
    if (carry != null) result.push(carry);
  }
  return result;
}

function computeParserHealth(diagnostics: ParserDiagnostic[], now: number): ParserHealthSummary {
  const cutoff = now - 7 * DAY;
  const empty = (): { ok: number; partial: number; failed: number; total: number } => ({
    ok: 0,
    partial: 0,
    failed: 0,
    total: 0,
  });
  const byMarketplace: Record<Marketplace, { ok: number; partial: number; failed: number; total: number }> = {
    ozon: empty(),
    wildberries: empty(),
    'yandex-market': empty(),
  };
  for (const d of diagnostics) {
    if (d.timestamp < cutoff) continue;
    const bucket = byMarketplace[d.marketplace];
    if (!bucket) continue;
    bucket.total += 1;
    bucketize(bucket, d.status);
  }
  let totalOk = 0;
  let total = 0;
  let failures7d = 0;
  for (const v of Object.values(byMarketplace)) {
    totalOk += v.ok;
    total += v.total;
    failures7d += v.failed;
  }
  const overallSuccessRate = total === 0 ? null : totalOk / total;
  const alarm = total >= 5 && overallSuccessRate != null && overallSuccessRate < 0.8;
  return { byMarketplace, overallSuccessRate, failures7d, alarm };
}

function bucketize(
  bucket: { ok: number; partial: number; failed: number },
  status: ParserStatus,
): void {
  if (status === 'ok') bucket.ok += 1;
  else if (status === 'partial') bucket.partial += 1;
  else bucket.failed += 1;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const stats = { computeOverview };
