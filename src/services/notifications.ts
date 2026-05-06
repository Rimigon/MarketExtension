import type {
  Availability,
  NotificationRule,
  NotificationTrigger,
  Product,
} from '@/shared/types';
import { formatPrice } from '@/shared/format';

export interface PriceTransition {
  /** Price/availability snapshot before this update — null when product is brand new. */
  prev: { price: number; availability: Availability; discountPct: number | null } | null;
  /** Snapshot after the update. Same as new pricePoint when one was recorded; mirrors product otherwise. */
  next: { price: number; availability: Availability; discountPct: number | null };
  /** Lowest price ever recorded for this product, NOT including the current update. null when no history. */
  historyMinBefore: number | null;
}

export interface NotificationMatch {
  rule: NotificationRule;
  title: string;
  body: string;
}

/**
 * Pure: given a product, the price transition and a list of applicable rules,
 * returns notifications that should fire. Cooldown is enforced by the caller
 * (it has access to the AppNotification history).
 */
export function evaluate(
  product: Product,
  transition: PriceTransition,
  rules: NotificationRule[],
): NotificationMatch[] {
  const matches: NotificationMatch[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.scope.kind === 'product' && rule.scope.productId !== product.id) continue;
    const fired = match(rule.trigger, transition);
    if (!fired) continue;
    matches.push({ rule, title: titleFor(rule.trigger, product, transition), body: bodyFor(product) });
  }
  return matches;
}

function match(trigger: NotificationTrigger, t: PriceTransition): boolean {
  switch (trigger.kind) {
    case 'priceBelow':
      // Fires only on the transition into "below" — prevents repeated fires while still below.
      return t.next.price < trigger.value && (t.prev == null || t.prev.price >= trigger.value);
    case 'dropPct': {
      if (!t.prev || t.prev.price <= 0) return false;
      const drop = (t.prev.price - t.next.price) / t.prev.price;
      return drop >= trigger.value;
    }
    case 'dropAbs':
      if (!t.prev) return false;
      return t.prev.price - t.next.price >= trigger.value;
    case 'discountAppeared': {
      const prevHadDiscount = t.prev?.discountPct != null && t.prev.discountPct > 0;
      const nextHasDiscount = t.next.discountPct != null && t.next.discountPct > 0;
      return !prevHadDiscount && nextHasDiscount;
    }
    case 'backInStock':
      if (!t.prev) return false;
      return t.prev.availability !== 'in_stock' && t.next.availability === 'in_stock';
    case 'historicalLow': {
      // Need at least some prior history to call something a "new low".
      if (t.historyMinBefore == null) return false;
      return t.next.price < t.historyMinBefore;
    }
    case 'sellerChanged':
      // Not tracked yet — wired up when we model seller info.
      return false;
  }
}

function titleFor(trigger: NotificationTrigger, p: Product, t: PriceTransition): string {
  switch (trigger.kind) {
    case 'priceBelow':
      return `${formatPrice(t.next.price)} · цель достигнута`;
    case 'dropPct': {
      if (!t.prev) return `Цена снизилась`;
      const dropPct = ((t.prev.price - t.next.price) / t.prev.price) * 100;
      return `Цена снизилась на ${dropPct.toFixed(0)}%`;
    }
    case 'dropAbs': {
      if (!t.prev) return `Цена снизилась`;
      const drop = t.prev.price - t.next.price;
      return `Цена снизилась на ${formatPrice(drop)}`;
    }
    case 'discountAppeared':
      return `Появилась скидка${p.discountPct ? ` −${p.discountPct}%` : ''}`;
    case 'backInStock':
      return `Снова в наличии`;
    case 'historicalLow':
      return `Исторический минимум · ${formatPrice(t.next.price)}`;
    case 'sellerChanged':
      return `Сменился продавец`;
  }
}

function bodyFor(p: Product): string {
  return p.title.length > 80 ? `${p.title.slice(0, 77)}…` : p.title;
}

export const notificationsService = { evaluate };
