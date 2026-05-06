import type { Marketplace, PricePoint, Product } from '@/shared/types';

export interface ProductMover {
  productId: string;
  title: string;
  marketplace: Marketplace;
  imageUrl?: string;
  current: number;
  prev: number;
  abs: number;
  pct: number;
}

export interface StatsOverview {
  totalActive: number;
  totalArchived: number;
  totalFavorites: number;
  byMarketplace: Record<Marketplace, number>;
  /** Сколько товаров подешевело за последние 7 дней. */
  drops7dCount: number;
  /** Сколько товаров подорожало за последние 7 дней. */
  rises7dCount: number;
  /** Топ-5 падений за 7 дней (по pct). */
  topDrops7d: ProductMover[];
  /** Топ-5 ростов за 7 дней (по pct). */
  topRises7d: ProductMover[];
  /** Средняя действующая скидка по активным товарам, у которых есть discountPct. 0..1 */
  avgDiscount: number | null;
  /** Сумма sum(min(allTime) − current)+ — потенциал сэкономленного при покупке на минимуме. */
  potentialSavings: number;
  /** Товары, которые не обновлялись > 7 дней. */
  staleCount: number;
  /** Сколько точек истории всего. */
  pricePointsCount: number;
}

const DAY = 24 * 60 * 60 * 1000;

export interface StatsInput {
  active: Product[];
  archived: Product[];
  /** Map productId → его price points (любого размера, не обязательно отсортированные). */
  pointsByProduct: Map<string, PricePoint[]>;
}

export function computeOverview(input: StatsInput, now: number = Date.now()): StatsOverview {
  const { active, archived, pointsByProduct } = input;

  const byMarketplace: Record<Marketplace, number> = {
    ozon: 0,
    wildberries: 0,
    'yandex-market': 0,
  };
  for (const p of active) byMarketplace[p.marketplace] += 1;

  const cutoff = now - 7 * DAY;
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
      if (pt.timestamp <= cutoff) ref = pt;
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
  for (const product of active) {
    if (product.currentPrice == null) continue;
    const points = pointsByProduct.get(product.id) ?? [];
    if (points.length === 0) continue;
    const minPrice = Math.min(...points.map((p) => p.price));
    const diff = product.currentPrice - minPrice;
    if (diff > 0) potentialSavings += diff;
  }

  const staleCutoff = now - 7 * DAY;
  const staleCount = active.filter((p) => p.updatedAt < staleCutoff).length;

  return {
    totalActive: active.length,
    totalArchived: archived.length,
    totalFavorites: active.filter((p) => p.isFavorite).length,
    byMarketplace,
    drops7dCount: drops,
    rises7dCount: rises,
    topDrops7d: topDrops,
    topRises7d: topRises,
    avgDiscount,
    potentialSavings: Math.round(potentialSavings),
    staleCount,
    pricePointsCount,
  };
}

export const stats = { computeOverview };
