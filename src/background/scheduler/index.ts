import {
  type ExecResult,
  pickReady,
  resolveTask,
  type UpdateTask,
} from '@/services/scheduler';
import type { Marketplace, ParsedProduct } from '@/shared/types';
import { productsRepo } from '@/data/products.repo';
import { settingsRepo } from '@/data/settings.repo';
import { handlers } from '../handlers';
import { execute } from './executor';
import { updateQueue } from './queue';

const ALARM_NAME = 'pricewatch:scheduler-tick';
const TICK_PERIOD_MIN = 5;
const RATE_LIMIT_MS = 8_000;
const MAX_PER_TICK = 5;

let initialized = false;
let tickInFlight = false;

/**
 * Idempotent: ensure the alarm exists and the chrome.alarms listener is wired.
 * Call this from background bootstrap, and again whenever scheduledUpdates is toggled on.
 */
export async function startScheduler(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  if (!initialized) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM_NAME) void runTick();
    });
    initialized = true;
  }
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: TICK_PERIOD_MIN,
      delayInMinutes: 1,
    });
    console.info('[PriceWatch] scheduler started, period =', TICK_PERIOD_MIN, 'min');
  }
  await reconcileQueue();
}

export async function stopScheduler(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  await chrome.alarms.clear(ALARM_NAME);
  await updateQueue.clear();
  console.info('[PriceWatch] scheduler stopped');
}

/**
 * Sync the queue with the current set of tracked products: add tasks for any new
 * products (with a near-future nextRunAt to spread load), remove tasks whose
 * products were deleted/archived. Existing tasks keep their state.
 */
export async function reconcileQueue(): Promise<void> {
  const products = await productsRepo.list({ archived: false });
  const settings = await settingsRepo.get();
  const intervalMs = settings.updateInterval * 60 * 1000;
  const state = await updateQueue.load();
  const byProductId = new Map(state.tasks.map((t) => [t.productId, t] as const));
  const now = Date.now();

  const next: UpdateTask[] = [];
  let spread = 0;
  for (const p of products) {
    const existing = byProductId.get(p.id);
    if (existing) {
      next.push({ ...existing, marketplace: p.marketplace, url: p.url });
    } else {
      // Stagger first runs across N seconds so we don't slam every API on the first tick.
      next.push({
        productId: p.id,
        marketplace: p.marketplace,
        url: p.url,
        nextRunAt: now + Math.min(intervalMs, 30_000) + spread * 5_000,
        attempts: 0,
      });
      spread++;
    }
  }
  await updateQueue.save({ tasks: next, lastRunByMarketplace: state.lastRunByMarketplace });
}

async function runTick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const settings = await settingsRepo.get();
    if (!settings.scheduledUpdates) {
      await stopScheduler();
      return;
    }

    const state = await updateQueue.load();
    const now = Date.now();
    const ready = pickReady(state.tasks, {
      now,
      lastRunByMarketplace: state.lastRunByMarketplace as Record<Marketplace, number>,
      rateLimitMs: RATE_LIMIT_MS,
      maxPerTick: MAX_PER_TICK,
    });

    if (ready.length === 0) return;
    console.info('[PriceWatch] tick: dispatching', ready.length, 'task(s)');

    const updatedById = new Map(state.tasks.map((t) => [t.productId, t] as const));
    const intervalMs = settings.updateInterval * 60 * 1000;

    for (const task of ready) {
      state.lastRunByMarketplace[task.marketplace] = Date.now();
      const result = await dispatch(task);
      const next = resolveTask(task, result, intervalMs, Date.now());
      if (next) updatedById.set(task.productId, next);
      else updatedById.delete(task.productId);
    }

    await updateQueue.save({
      tasks: [...updatedById.values()],
      lastRunByMarketplace: state.lastRunByMarketplace,
    });
  } catch (err) {
    console.warn('[PriceWatch] scheduler tick failed', err);
  } finally {
    tickInFlight = false;
  }
}

async function dispatch(task: UpdateTask): Promise<ExecResult> {
  const result = await execute(task.marketplace, task.url);
  if (!result.ok) return { kind: 'failure', error: result.error };
  try {
    await persist(result.parsed);
    return { kind: 'success' };
  } catch (err) {
    return { kind: 'failure', error: err instanceof Error ? err.message : String(err) };
  }
}

async function persist(parsed: ParsedProduct): Promise<void> {
  // Reuse the product/add handler so we get the same update + price-point + notification flow.
  await handlers['product/add']({ parsed, source: 'manual' }, {} as chrome.runtime.MessageSender);
}

/**
 * Public hook for handlers — called when the user changes settings or
 * adds/removes products. Keeps the queue and alarm in sync without waiting
 * for the next tick.
 */
export async function applySettings(): Promise<void> {
  const settings = await settingsRepo.get();
  if (settings.scheduledUpdates) {
    await startScheduler();
  } else {
    await stopScheduler();
  }
}
