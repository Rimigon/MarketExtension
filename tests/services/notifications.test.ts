import { describe, expect, it } from 'vitest';
import { evaluate, type PriceTransition } from '@/services/notifications';
import type { NotificationRule, Product } from '@/shared/types';

function product(overrides: Partial<Product> = {}): Product {
  const now = Date.now();
  return {
    id: 'p1',
    marketplace: 'ozon',
    url: 'https://www.ozon.ru/product/foo-1',
    canonicalUrl: '/product/foo-1',
    sku: 'SKU1',
    title: 'Кофемолка ROCKET',
    currentPrice: 9000,
    oldPrice: null,
    currency: 'RUB',
    discountPct: null,
    availability: 'in_stock',
    addedAt: now,
    updatedAt: now,
    lastSeenAt: now,
    parserVersion: 1,
    parserStatus: 'ok',
    isArchived: false,
    isFavorite: false,
    tags: [],
    collectionIds: [],
    ...overrides,
  };
}

function rule(overrides: Partial<NotificationRule> & Pick<NotificationRule, 'trigger'>): NotificationRule {
  return {
    id: 'r1',
    scope: { kind: 'global' },
    enabled: true,
    cooldownMinutes: 60,
    ...overrides,
  };
}

describe('notificationsService.evaluate — dropPct', () => {
  const r = rule({ trigger: { kind: 'dropPct', value: 0.05 } });

  it('fires when price drops by ≥ threshold', () => {
    const t: PriceTransition = {
      prev: { price: 10_000, availability: 'in_stock', discountPct: null },
      next: { price: 9_400, availability: 'in_stock', discountPct: null },
      historyMinBefore: 10_000,
    };
    const m = evaluate(product(), t, [r]);
    expect(m).toHaveLength(1);
    expect(m[0].rule.id).toBe('r1');
  });

  it('does not fire when drop is below threshold', () => {
    const t: PriceTransition = {
      prev: { price: 10_000, availability: 'in_stock', discountPct: null },
      next: { price: 9_700, availability: 'in_stock', discountPct: null }, // 3% drop
      historyMinBefore: 10_000,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(0);
  });

  it('does not fire on a price increase', () => {
    const t: PriceTransition = {
      prev: { price: 10_000, availability: 'in_stock', discountPct: null },
      next: { price: 10_500, availability: 'in_stock', discountPct: null },
      historyMinBefore: 10_000,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(0);
  });

  it('does not fire when there is no prev (newly tracked product)', () => {
    const t: PriceTransition = {
      prev: null,
      next: { price: 5_000, availability: 'in_stock', discountPct: null },
      historyMinBefore: null,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(0);
  });
});

describe('notificationsService.evaluate — priceBelow', () => {
  const r = rule({ trigger: { kind: 'priceBelow', value: 5_000 } });

  it('fires on the transition into "below" range', () => {
    const t: PriceTransition = {
      prev: { price: 6_000, availability: 'in_stock', discountPct: null },
      next: { price: 4_900, availability: 'in_stock', discountPct: null },
      historyMinBefore: 6_000,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(1);
  });

  it('does not fire when previous was already below (no transition)', () => {
    const t: PriceTransition = {
      prev: { price: 4_500, availability: 'in_stock', discountPct: null },
      next: { price: 4_400, availability: 'in_stock', discountPct: null },
      historyMinBefore: 4_500,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(0);
  });

  it('fires for newly-added products that are already below threshold', () => {
    const t: PriceTransition = {
      prev: null,
      next: { price: 4_500, availability: 'in_stock', discountPct: null },
      historyMinBefore: null,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(1);
  });
});

describe('notificationsService.evaluate — historicalLow', () => {
  const r = rule({ trigger: { kind: 'historicalLow' } });

  it('fires when next price strictly beats history min', () => {
    const t: PriceTransition = {
      prev: { price: 9_500, availability: 'in_stock', discountPct: null },
      next: { price: 8_800, availability: 'in_stock', discountPct: null },
      historyMinBefore: 9_000,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(1);
  });

  it('does not fire when matching history min (must be strictly lower)', () => {
    const t: PriceTransition = {
      prev: { price: 9_500, availability: 'in_stock', discountPct: null },
      next: { price: 9_000, availability: 'in_stock', discountPct: null },
      historyMinBefore: 9_000,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(0);
  });

  it('does not fire on a brand-new product (no history yet)', () => {
    const t: PriceTransition = {
      prev: null,
      next: { price: 5_000, availability: 'in_stock', discountPct: null },
      historyMinBefore: null,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(0);
  });
});

describe('notificationsService.evaluate — backInStock', () => {
  const r = rule({ trigger: { kind: 'backInStock' } });

  it('fires on transition out_of_stock → in_stock', () => {
    const t: PriceTransition = {
      prev: { price: 1_000, availability: 'out_of_stock', discountPct: null },
      next: { price: 1_000, availability: 'in_stock', discountPct: null },
      historyMinBefore: 1_000,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(1);
  });

  it('does not fire when both states are in_stock', () => {
    const t: PriceTransition = {
      prev: { price: 1_000, availability: 'in_stock', discountPct: null },
      next: { price: 1_000, availability: 'in_stock', discountPct: null },
      historyMinBefore: 1_000,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(0);
  });
});

describe('notificationsService.evaluate — discountAppeared', () => {
  const r = rule({ trigger: { kind: 'discountAppeared' } });

  it('fires when prev had no discount and next has one', () => {
    const t: PriceTransition = {
      prev: { price: 1_000, availability: 'in_stock', discountPct: null },
      next: { price: 800, availability: 'in_stock', discountPct: 20 },
      historyMinBefore: 1_000,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(1);
  });

  it('does not fire when discount was already present', () => {
    const t: PriceTransition = {
      prev: { price: 800, availability: 'in_stock', discountPct: 20 },
      next: { price: 750, availability: 'in_stock', discountPct: 25 },
      historyMinBefore: 800,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(0);
  });
});

describe('notificationsService.evaluate — scope', () => {
  it('skips disabled rules', () => {
    const r = rule({ trigger: { kind: 'dropPct', value: 0.05 }, enabled: false });
    const t: PriceTransition = {
      prev: { price: 10_000, availability: 'in_stock', discountPct: null },
      next: { price: 9_000, availability: 'in_stock', discountPct: null },
      historyMinBefore: 10_000,
    };
    expect(evaluate(product(), t, [r])).toHaveLength(0);
  });

  it('skips product-scoped rules from a different product', () => {
    const r = rule({
      trigger: { kind: 'dropPct', value: 0.05 },
      scope: { kind: 'product', productId: 'other' },
    });
    const t: PriceTransition = {
      prev: { price: 10_000, availability: 'in_stock', discountPct: null },
      next: { price: 9_000, availability: 'in_stock', discountPct: null },
      historyMinBefore: 10_000,
    };
    expect(evaluate(product({ id: 'p1' }), t, [r])).toHaveLength(0);
  });

  it('matches product-scoped rules with correct productId', () => {
    const r = rule({
      trigger: { kind: 'dropPct', value: 0.05 },
      scope: { kind: 'product', productId: 'p1' },
    });
    const t: PriceTransition = {
      prev: { price: 10_000, availability: 'in_stock', discountPct: null },
      next: { price: 9_000, availability: 'in_stock', discountPct: null },
      historyMinBefore: 10_000,
    };
    expect(evaluate(product({ id: 'p1' }), t, [r])).toHaveLength(1);
  });
});
