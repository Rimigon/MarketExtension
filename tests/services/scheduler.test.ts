import { describe, expect, it } from 'vitest';
import {
  applyJitter,
  computeBackoff,
  MAX_ATTEMPTS,
  pickReady,
  resolveTask,
  type UpdateTask,
} from '@/services/scheduler';

function task(overrides: Partial<UpdateTask> & Pick<UpdateTask, 'productId' | 'marketplace'>): UpdateTask {
  return {
    url: `https://example.com/${overrides.productId}`,
    nextRunAt: 0,
    attempts: 0,
    ...overrides,
  };
}

const EMPTY_LAST: Record<'ozon' | 'wildberries' | 'yandex-market', number> = {
  ozon: 0,
  wildberries: 0,
  'yandex-market': 0,
};

describe('scheduler.pickReady', () => {
  it('skips tasks not yet due', () => {
    const now = 1000;
    const tasks = [task({ productId: 'a', marketplace: 'wildberries', nextRunAt: 2000 })];
    expect(pickReady(tasks, { now, lastRunByMarketplace: EMPTY_LAST })).toHaveLength(0);
  });

  it('returns one task per marketplace per rate-limit window', () => {
    const now = 10_000;
    const tasks = [
      task({ productId: 'a', marketplace: 'wildberries', nextRunAt: 100 }),
      task({ productId: 'b', marketplace: 'wildberries', nextRunAt: 200 }),
      task({ productId: 'c', marketplace: 'ozon', nextRunAt: 300 }),
    ];
    const picked = pickReady(tasks, { now, lastRunByMarketplace: EMPTY_LAST, rateLimitMs: 8_000 });
    const wbCount = picked.filter((t) => t.marketplace === 'wildberries').length;
    const ozCount = picked.filter((t) => t.marketplace === 'ozon').length;
    expect(wbCount).toBe(1);
    expect(ozCount).toBe(1);
    expect(picked).toHaveLength(2);
  });

  it('honors lastRunByMarketplace as a recent invocation', () => {
    const now = 10_000;
    const tasks = [task({ productId: 'a', marketplace: 'wildberries', nextRunAt: 100 })];
    const picked = pickReady(tasks, {
      now,
      lastRunByMarketplace: { ...EMPTY_LAST, wildberries: now - 1000 },
      rateLimitMs: 8_000,
    });
    expect(picked).toHaveLength(0);
  });

  it('orders by nextRunAt ascending', () => {
    const now = 10_000;
    const tasks = [
      task({ productId: 'a', marketplace: 'wildberries', nextRunAt: 500 }),
      task({ productId: 'b', marketplace: 'ozon', nextRunAt: 100 }),
    ];
    const picked = pickReady(tasks, { now, lastRunByMarketplace: EMPTY_LAST });
    expect(picked[0].productId).toBe('b');
    expect(picked[1].productId).toBe('a');
  });

  it('respects maxPerTick', () => {
    const now = 10_000;
    const tasks = [
      task({ productId: 'a', marketplace: 'wildberries', nextRunAt: 100 }),
      task({ productId: 'b', marketplace: 'ozon', nextRunAt: 100 }),
      task({ productId: 'c', marketplace: 'yandex-market', nextRunAt: 100 }),
    ];
    const picked = pickReady(tasks, { now, lastRunByMarketplace: EMPTY_LAST, maxPerTick: 2 });
    expect(picked).toHaveLength(2);
  });
});

describe('scheduler.computeBackoff', () => {
  it('first retry is 30s, last in ladder is 1h', () => {
    expect(computeBackoff(0)).toBe(30_000);
    expect(computeBackoff(3)).toBe(60 * 60 * 1000);
  });

  it('returns Infinity beyond the ladder', () => {
    expect(computeBackoff(99)).toBe(Infinity);
  });
});

describe('scheduler.applyJitter', () => {
  it('±20% by default — output stays in expected window', () => {
    for (let i = 0; i < 100; i++) {
      const v = applyJitter(1000, 0.2);
      expect(v).toBeGreaterThanOrEqual(800);
      expect(v).toBeLessThanOrEqual(1200);
    }
  });

  it('uses injected random for determinism', () => {
    expect(applyJitter(1000, 0.5, () => 0)).toBe(500);
    expect(applyJitter(1000, 0.5, () => 1)).toBe(1500);
    expect(applyJitter(1000, 0.5, () => 0.5)).toBe(1000);
  });
});

describe('scheduler.resolveTask', () => {
  const baseTask: UpdateTask = {
    productId: 'x',
    marketplace: 'wildberries',
    url: 'https://example.com',
    nextRunAt: 0,
    attempts: 2,
    lastError: 'boom',
  };

  it('on success, resets attempts and reschedules to now+interval (with jitter)', () => {
    const out = resolveTask(baseTask, { kind: 'success' }, 60_000, 100_000, () => 0.5);
    expect(out).not.toBeNull();
    expect(out!.attempts).toBe(0);
    expect(out!.lastError).toBeUndefined();
    expect(out!.lastAttemptedAt).toBe(100_000);
    expect(out!.nextRunAt).toBe(160_000);
  });

  it('on failure, increments attempts and applies backoff', () => {
    const out = resolveTask(
      { ...baseTask, attempts: 0 },
      { kind: 'failure', error: 'http_500' },
      60_000,
      100_000,
      () => 0.5,
    );
    expect(out).not.toBeNull();
    expect(out!.attempts).toBe(1);
    expect(out!.nextRunAt).toBe(100_000 + 30_000);
    expect(out!.lastError).toBe('http_500');
  });

  it('returns null when max attempts exceeded', () => {
    const out = resolveTask(
      { ...baseTask, attempts: MAX_ATTEMPTS },
      { kind: 'failure', error: 'boom' },
      60_000,
      100_000,
    );
    expect(out).toBeNull();
  });
});
