import type { Marketplace } from '@/shared/types';

export interface UpdateTask {
  productId: string;
  marketplace: Marketplace;
  url: string;
  /** When this task is allowed to run (epoch ms). */
  nextRunAt: number;
  /** How many times this task has been attempted in the current backoff chain. Resets to 0 on success. */
  attempts: number;
  /** Last error string for diagnostics. */
  lastError?: string;
  /** When the task was last attempted (success or failure). */
  lastAttemptedAt?: number;
}

export const MAX_ATTEMPTS = 4;

const RATE_LIMIT_MS_DEFAULT = 8_000;

const BACKOFF_LADDER_MS = [
  30 * 1000,        // 30s
  2 * 60 * 1000,    // 2m
  10 * 60 * 1000,   // 10m
  60 * 60 * 1000,   // 1h
];

export interface PickConfig {
  now: number;
  lastRunByMarketplace: Record<Marketplace, number>;
  /** Minimal gap between two heavy tasks of the same marketplace. */
  rateLimitMs?: number;
  /** Maximum tasks dispatched per tick (across all marketplaces). */
  maxPerTick?: number;
}

/**
 * Pure: pick tasks ready to run, respecting per-marketplace rate limit.
 * Tasks are sorted by `nextRunAt` ascending, oldest-due first. Within a marketplace,
 * only one task may run per `rateLimitMs` window; tasks blocked by the limit are
 * deferred to the next tick.
 */
export function pickReady(tasks: UpdateTask[], cfg: PickConfig): UpdateTask[] {
  const rateLimit = cfg.rateLimitMs ?? RATE_LIMIT_MS_DEFAULT;
  const maxPerTick = cfg.maxPerTick ?? Infinity;
  const seen: Record<Marketplace, number> = { ...cfg.lastRunByMarketplace };
  const ready = [...tasks]
    .filter((t) => t.nextRunAt <= cfg.now)
    .sort((a, b) => a.nextRunAt - b.nextRunAt);

  const out: UpdateTask[] = [];
  for (const t of ready) {
    if (out.length >= maxPerTick) break;
    const last = seen[t.marketplace] ?? 0;
    if (cfg.now - last < rateLimit) continue;
    out.push(t);
    seen[t.marketplace] = cfg.now;
  }
  return out;
}

/**
 * Backoff for the Nth attempt (0-indexed: attempt=0 → 30s, attempt=3 → 1h).
 * Beyond the ladder, returns Infinity (caller should drop the task).
 */
export function computeBackoff(attempt: number): number {
  if (attempt < 0) return BACKOFF_LADDER_MS[0];
  if (attempt >= BACKOFF_LADDER_MS.length) return Infinity;
  return BACKOFF_LADDER_MS[attempt];
}

/**
 * Apply a symmetric jitter `±ratio` to a base duration. Returns a value in
 * `[base * (1 - ratio), base * (1 + ratio)]`. `random` is injectable for tests.
 */
export function applyJitter(baseMs: number, ratio = 0.2, random = Math.random): number {
  const offset = (random() * 2 - 1) * ratio * baseMs;
  return Math.max(0, Math.round(baseMs + offset));
}

export interface SuccessResult {
  kind: 'success';
}

export interface FailureResult {
  kind: 'failure';
  error: string;
}

export type ExecResult = SuccessResult | FailureResult;

/**
 * After a task completes (success or failure), produce the updated task. Returns
 * null when the task should be dropped from the queue (max attempts reached).
 */
export function resolveTask(
  task: UpdateTask,
  result: ExecResult,
  intervalMs: number,
  now: number,
  random = Math.random,
): UpdateTask | null {
  if (result.kind === 'success') {
    return {
      ...task,
      attempts: 0,
      lastError: undefined,
      lastAttemptedAt: now,
      nextRunAt: now + applyJitter(intervalMs, 0.2, random),
    };
  }
  const nextAttempt = task.attempts + 1;
  if (nextAttempt > MAX_ATTEMPTS) return null;
  const backoff = computeBackoff(task.attempts);
  if (!Number.isFinite(backoff)) return null;
  return {
    ...task,
    attempts: nextAttempt,
    lastError: result.error,
    lastAttemptedAt: now,
    nextRunAt: now + applyJitter(backoff, 0.2, random),
  };
}
