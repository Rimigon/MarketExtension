import type { PricePoint } from '@/shared/types';

export type RecommendationVerdict =
  | 'buy_now'
  | 'good_price'
  | 'fair_price'
  | 'overpriced'
  | 'no_data';

export interface Recommendation {
  verdict: RecommendationVerdict;
  /** 0..1, доля точек истории, у которых цена ≤ текущей. */
  percentile: number | null;
  /** Текущая цена. */
  current: number | null;
  /** Минимум за всю историю. */
  min: number | null;
  /** Медиана за всю историю. */
  median: number | null;
  /** Сколько точек истории учтено. */
  sampleSize: number;
  /** Локализованный заголовок и подсказка. */
  title: string;
  hint: string;
}

const NO_DATA: Omit<Recommendation, 'current'> = {
  verdict: 'no_data',
  percentile: null,
  min: null,
  median: null,
  sampleSize: 0,
  title: 'Недостаточно данных',
  hint: 'Появится после нескольких обновлений цены.',
};

/**
 * Recommend whether to buy at the current price based on percentile in the
 * historical distribution.
 *
 *   percentile ≤ 0.10 → buy_now
 *   0.10 < p ≤ 0.40   → good_price
 *   0.40 < p ≤ 0.70   → fair_price
 *   0.70 < p          → overpriced
 *
 * Requires ≥ 5 points; below that we don't have enough signal.
 */
export function recommend(currentPrice: number | null, points: PricePoint[]): Recommendation {
  if (currentPrice == null || currentPrice <= 0) {
    return { ...NO_DATA, current: currentPrice };
  }
  if (points.length < 5) {
    return { ...NO_DATA, current: currentPrice, sampleSize: points.length };
  }

  const prices = points.map((p) => p.price).filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length < 5) {
    return { ...NO_DATA, current: currentPrice, sampleSize: prices.length };
  }
  const min = prices[0];
  const median = quantile(prices, 0.5);
  // share of points whose price is ≤ currentPrice. Lower = better deal now.
  const lessOrEqual = prices.filter((p) => p <= currentPrice).length;
  const percentile = lessOrEqual / prices.length;

  let verdict: RecommendationVerdict;
  let title: string;
  let hint: string;

  if (percentile <= 0.1) {
    verdict = 'buy_now';
    title = 'Покупать сейчас';
    hint = 'Цена в нижних 10% за всю историю наблюдений.';
  } else if (percentile <= 0.4) {
    verdict = 'good_price';
    title = 'Хорошая цена';
    hint = 'Заметно ниже привычного уровня.';
  } else if (percentile <= 0.7) {
    verdict = 'fair_price';
    title = 'Обычная цена';
    hint = 'Близко к историческому медианному уровню.';
  } else {
    verdict = 'overpriced';
    title = 'Цена выше обычной';
    hint = 'Сейчас выше, чем у большинства точек истории — есть смысл подождать.';
  }

  return {
    verdict,
    percentile,
    current: currentPrice,
    min,
    median,
    sampleSize: prices.length,
    title,
    hint,
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export const recommendation = { recommend };
