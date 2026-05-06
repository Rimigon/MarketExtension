import type { ParsedProduct } from '@/shared/types';
import { productsRepo } from '@/data/products.repo';
import { settingsRepo } from '@/data/settings.repo';
import { notificationsRepo } from '@/data/notifications.repo';
import { handlers } from '../handlers';
import { refreshBadge } from '../notifier';
import { execute } from './executor';

/**
 * Single global alarm whose firing schedule *is* the user's update cadence —
 * `periodInMinutes` mirrors `settings.updateInterval`. When it fires we run
 * the same bulk refresh as the dashboard's «Обновить все» button.
 *
 * Chrome itself handles waking the service worker exactly at the configured
 * interval, so we don't need any per-tick "is it time yet?" bookkeeping.
 */
const ALARM_NAME = 'pricewatch:bulk-refresh';
const BROADCAST_TYPE = 'pricewatch:scheduledRefreshDone';
const NOTIF_ID_PREFIX = 'pricewatch:scheduledRefresh:';
// `lastRunAt` and the schedule signature live in chrome.storage.local so they
// survive browser restarts — needed for daily-mode catch-up logic.
const LAST_RUN_KEY = 'pricewatch:scheduler:lastRunAt';
const SIGNATURE_KEY = 'pricewatch:scheduler:signature';
const PENDING_SUMMARY_KEY = 'pricewatch:scheduler:pendingSummary';

interface ScheduleSignature {
  mode: 'interval' | 'daily';
  intervalMinutes: number;
  dailyAtHour: number | null;
}

interface ScheduledRefreshSummary {
  total: number;
  succeeded: number;
  failed: number;
  changes: { id: string; title: string; before: number; after: number }[];
}

let runInFlight = false;

// Module-init: attach the alarm listener synchronously at SW boot so an
// alarm-triggered SW wake-up doesn't miss the event.
if (typeof chrome !== 'undefined' && chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      console.info('[PriceWatch] alarm fired', new Date().toISOString());
      void runScheduledBulk();
    }
  });
}

/* ----------------------------- public API ------------------------------- */

export async function startScheduler(): Promise<void> {
  // Just delegate — applySettings reads settings and arms the alarm.
  await applySettings();
}

export async function stopScheduler(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  await chrome.alarms.clear(ALARM_NAME);
  console.info('[PriceWatch] scheduler stopped');
}

/**
 * Hook called by the settings handler and bootstrap. Wires the alarm to match
 * `updateInterval` (or `dailyAtHour`).
 *
 * Idempotency is critical here: bootstrap runs on *every* SW wake-up (and the
 * SW dies every ~30s of idle), so this is called many times per session.
 * Re-creating the alarm each time would reset its `scheduledTime` to
 * `now + interval`, making the timer appear frozen at "через 15 минут".
 * We only recreate when the schedule actually changed.
 */
export async function applySettings(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  const settings = await settingsRepo.get();
  if (!settings.scheduledUpdates) {
    await chrome.alarms.clear(ALARM_NAME);
    await writeSignature(null);
    console.info('[PriceWatch] scheduler disabled');
    return;
  }

  const wantSig: ScheduleSignature = {
    mode: settings.dailyAtHour != null ? 'daily' : 'interval',
    intervalMinutes: settings.updateInterval,
    dailyAtHour: settings.dailyAtHour,
  };
  const haveSig = await readSignature();
  const existing = await chrome.alarms.get(ALARM_NAME);
  const sameSchedule =
    existing != null &&
    haveSig != null &&
    haveSig.mode === wantSig.mode &&
    haveSig.intervalMinutes === wantSig.intervalMinutes &&
    haveSig.dailyAtHour === wantSig.dailyAtHour;

  if (sameSchedule) {
    // Bootstrap path on SW wake — schedule unchanged, leave the alarm running.
    console.info('[PriceWatch] scheduler already armed, skipping');
    return;
  }

  if (settings.dailyAtHour != null) {
    await armDaily(settings.dailyAtHour);
  } else {
    await armInterval(settings.updateInterval);
  }
  await writeSignature(wantSig);
}

/**
 * Daily-mode arming. If the configured hour has already passed today AND we
 * haven't run since the last occurrence of that hour, fire a catch-up bulk
 * refresh immediately (don't make the user wait until tomorrow). Then schedule
 * the alarm for the next occurrence.
 */
async function armDaily(hour: number): Promise<void> {
  const now = Date.now();
  const todayAt = atLocalHour(now, hour); // today at HH:00 local time
  const lastRun = (await readLastRunAt()) ?? 0;

  // Catch-up: today's hour passed and we never ran for it (browser was off).
  if (now >= todayAt && lastRun < todayAt) {
    console.info(
      '[PriceWatch] daily catch-up: fired late by',
      Math.round((now - todayAt) / 60_000),
      'min — running now',
    );
    // Mark as run *before* the heavy work so a parallel SW wake doesn't double-fire.
    await writeLastRunAt(now);
    void runScheduledBulk();
  }

  const delayMs = msUntilDailyHour(hour);
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: 24 * 60,
    delayInMinutes: Math.max(1, Math.round(delayMs / 60_000)),
  });
  console.info(
    '[PriceWatch] scheduler armed: daily at',
    String(hour).padStart(2, '0') + ':00, first in',
    Math.round(delayMs / 60_000),
    'min',
  );
}

async function armInterval(intervalMinutes: number): Promise<void> {
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: intervalMinutes,
    delayInMinutes: intervalMinutes,
  });
  console.info('[PriceWatch] scheduler armed: every', intervalMinutes, 'min');
}

/** Stub kept for callers that used to reconcile the per-product queue. */
export async function reconcileQueue(): Promise<void> {
  // No-op — bulk refresh always reads the current product list at fire time.
}

/**
 * Read-and-clear: returns the most recent scheduler summary that the dashboard
 * hasn't seen yet. Used by the dashboard on mount to surface a toast when it
 * opens after a background refresh ran.
 */
export async function takePendingSummary(): Promise<{
  summary: ScheduledRefreshSummary | null;
  at: number | null;
}> {
  const v = await readPendingSummary();
  if (v) await clearPendingSummary();
  return { summary: v?.summary ?? null, at: v?.at ?? null };
}

export async function getSchedulerStatus(): Promise<{
  enabled: boolean;
  nextRunAt: number | null;
  queueSize: number;
  mode: 'interval' | 'daily';
  intervalMinutes: number;
  dailyAtHour: number | null;
  lastRunAt: number | null;
}> {
  const settings = await settingsRepo.get();
  const alarm =
    typeof chrome !== 'undefined' && chrome.alarms
      ? await chrome.alarms.get(ALARM_NAME)
      : undefined;
  const products = await productsRepo.list({ archived: false });
  const lastRunAt = await readLastRunAt();
  return {
    enabled: settings.scheduledUpdates,
    nextRunAt: alarm?.scheduledTime ?? null,
    queueSize: products.length,
    mode: settings.dailyAtHour != null ? 'daily' : 'interval',
    intervalMinutes: settings.updateInterval,
    dailyAtHour: settings.dailyAtHour,
    lastRunAt,
  };
}

/* --------------------------- bulk refresh ------------------------------- */

async function runScheduledBulk(): Promise<void> {
  if (runInFlight) {
    console.info('[PriceWatch] bulk: already in flight, skipping');
    return;
  }
  runInFlight = true;
  try {
    const settings = await settingsRepo.get();
    if (!settings.scheduledUpdates) {
      await chrome.alarms.clear(ALARM_NAME);
      return;
    }
    console.info('[PriceWatch] bulk: starting');
    const summary = await runBulkRefresh();
    const completedAt = Date.now();
    await writeLastRunAt(completedAt);
    console.info(
      '[PriceWatch] bulk: done',
      summary.succeeded,
      '/',
      summary.total,
      'failed:',
      summary.failed,
    );
    await notifyComplete(summary);
  } catch (err) {
    console.warn('[PriceWatch] bulk failed', err);
  } finally {
    runInFlight = false;
  }
}

async function runBulkRefresh(): Promise<ScheduledRefreshSummary> {
  const products = await productsRepo.list({ archived: false });
  const summary: ScheduledRefreshSummary = {
    total: products.length,
    succeeded: 0,
    failed: 0,
    changes: [],
  };
  for (const p of products) {
    const before = p.currentPrice;
    try {
      const result = await execute(p.marketplace, p.url, { allowHiddenTab: true });
      if (!result.ok) {
        summary.failed++;
        continue;
      }
      await persist(result.parsed);
      summary.succeeded++;
      const after = result.parsed.currentPrice;
      if (before != null && after != null && after !== before) {
        summary.changes.push({ id: p.id, title: p.title, before, after });
      }
    } catch (err) {
      summary.failed++;
      console.warn('[PriceWatch] bulk item failed', p.id, err);
    }
  }
  return summary;
}

async function persist(parsed: ParsedProduct): Promise<void> {
  await handlers['product/add'](
    { parsed, source: 'manual' },
    {} as chrome.runtime.MessageSender,
  );
}

/* ---------------------- post-refresh notifications ---------------------- */

/** Sentinel productId for global (non-product-bound) notifications shown in
 *  the dashboard's «Уведомления» list — e.g. the bulk-refresh summary. */
const GLOBAL_NOTIFICATION_PRODUCT_ID = '_global';
const SCHEDULED_BULK_RULE_ID = '_scheduledBulk';

function summaryMessage(summary: ScheduledRefreshSummary): string {
  const drops = summary.changes.filter((c) => c.after < c.before).length;
  const rises = summary.changes.filter((c) => c.after > c.before).length;
  const parts: string[] = [];
  if (drops) parts.push(`${drops} ↓`);
  if (rises) parts.push(`${rises} ↑`);
  if (summary.changes.length === 0 && summary.succeeded > 0) parts.push('без изменений');
  if (summary.failed) parts.push(`${summary.failed} ошибок`);
  return `Обновлено ${summary.succeeded}/${summary.total}${
    parts.length ? ` · ${parts.join(', ')}` : ''
  }`;
}

async function notifyComplete(summary: ScheduledRefreshSummary): Promise<void> {
  // 1. Persist summary so the dashboard can pick it up on next open even if it
  //    was closed during the bulk run.
  await writePendingSummary(summary);

  // 2. Persist a row in the notifications history so the user sees a record in
  //    the dashboard's «Уведомления» list — even after dismissing the toast.
  if (summary.total > 0) {
    try {
      await notificationsRepo.record({
        productId: GLOBAL_NOTIFICATION_PRODUCT_ID,
        ruleId: SCHEDULED_BULK_RULE_ID,
        title: 'Фоновая проверка',
        body: summaryMessage(summary),
      });
      await refreshBadge();
    } catch (err) {
      console.warn('[PriceWatch] persist scheduled-bulk notification failed', err);
    }
  }

  // 3. System notification — visible even when the dashboard is closed.
  if (typeof chrome !== 'undefined' && chrome.notifications) {
    const message = summaryMessage(summary);
    // Unique id — Chrome silently ignores `create` if a notification with the
    // same id already exists in the OS notification center.
    const id = `${NOTIF_ID_PREFIX}${Date.now()}`;
    try {
      chrome.notifications.create(
        id,
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('public/icons/icon-128.png'),
          title: 'PriceWatch — фоновая проверка',
          message,
          priority: 1,
        },
        () => {
          const err = chrome.runtime.lastError;
          if (err) {
            console.warn('[PriceWatch] notifications.create error', err.message);
          } else {
            console.info('[PriceWatch] system notification posted', id);
          }
        },
      );
    } catch (err) {
      console.warn('[PriceWatch] notifications.create threw', err);
    }
  } else {
    console.warn('[PriceWatch] chrome.notifications unavailable');
  }

  // 3. Broadcast — open dashboard pages will show the toast immediately.
  try {
    void chrome.runtime
      .sendMessage({ type: BROADCAST_TYPE, summary })
      .catch(() => {
        // No listeners (dashboard not open) — fine, summary persisted above.
      });
  } catch {
    // sendMessage throws synchronously under some Chromium versions
    // when no listeners exist.
  }
}

async function writePendingSummary(summary: ScheduledRefreshSummary): Promise<void> {
  try {
    await chrome.storage.session.set({
      [PENDING_SUMMARY_KEY]: { summary, at: Date.now() },
    });
  } catch {
    // ignore
  }
}

async function readPendingSummary(): Promise<{
  summary: ScheduledRefreshSummary;
  at: number;
} | null> {
  try {
    const r = await chrome.storage.session.get(PENDING_SUMMARY_KEY);
    const v = r[PENDING_SUMMARY_KEY];
    if (
      v &&
      typeof v === 'object' &&
      typeof v.at === 'number' &&
      v.summary &&
      typeof v.summary === 'object'
    ) {
      return v as { summary: ScheduledRefreshSummary; at: number };
    }
    return null;
  } catch {
    return null;
  }
}

async function clearPendingSummary(): Promise<void> {
  try {
    await chrome.storage.session.remove(PENDING_SUMMARY_KEY);
  } catch {
    // ignore
  }
}

/* ----------------------------- helpers ---------------------------------- */

function msUntilDailyHour(hour: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/** Today (local) at the given hour:00:00. */
function atLocalHour(nowMs: number, hour: number): number {
  const d = new Date(nowMs);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

async function readLastRunAt(): Promise<number | null> {
  try {
    const r = await chrome.storage.local.get(LAST_RUN_KEY);
    const v = r[LAST_RUN_KEY];
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

async function writeLastRunAt(ts: number): Promise<void> {
  try {
    await chrome.storage.local.set({ [LAST_RUN_KEY]: ts });
  } catch {
    // ignore
  }
}

async function readSignature(): Promise<ScheduleSignature | null> {
  try {
    const r = await chrome.storage.local.get(SIGNATURE_KEY);
    const v = r[SIGNATURE_KEY];
    if (
      v &&
      typeof v === 'object' &&
      (v.mode === 'interval' || v.mode === 'daily') &&
      typeof v.intervalMinutes === 'number'
    ) {
      return v as ScheduleSignature;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeSignature(sig: ScheduleSignature | null): Promise<void> {
  try {
    if (sig == null) await chrome.storage.local.remove(SIGNATURE_KEY);
    else await chrome.storage.local.set({ [SIGNATURE_KEY]: sig });
  } catch {
    // ignore
  }
}

export const SCHEDULED_REFRESH_BROADCAST_TYPE = BROADCAST_TYPE;
