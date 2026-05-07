import { db } from '@/data/db';
import { planCompaction, planDiagnosticsPurge } from '@/services/maintenance';

/**
 * Daily maintenance: compact old pricePoints + purge stale parserDiagnostics.
 * Runs via chrome.alarms (separate from the bulk-refresh alarm) and as a
 * catch-up when the SW boots if it has been > 24h since the last run.
 */

const ALARM_NAME = 'pricewatch:maintenance';
const LAST_RUN_KEY = 'pricewatch:maintenance:lastRunAt';
const PERIOD_MINUTES = 24 * 60;
const CATCHUP_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface MaintenanceResult {
  pricePointsRemoved: number;
  diagnosticsRemoved: number;
  durationMs: number;
}

let runInFlight = false;

export function registerMaintenanceAlarm(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      console.info('[PriceWatch] maintenance alarm fired', new Date().toISOString());
      void runMaintenance();
    }
  });
}

/** Arm the alarm and run a catch-up if it has been > 24h since last run. */
export async function startMaintenance(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: PERIOD_MINUTES,
      delayInMinutes: 60,
    });
    console.info('[PriceWatch] maintenance alarm armed');
  }
  const last = await readLastRunAt();
  if (last == null || Date.now() - last > CATCHUP_THRESHOLD_MS) {
    void runMaintenance();
  }
}

export async function runMaintenance(): Promise<MaintenanceResult | null> {
  if (runInFlight) return null;
  runInFlight = true;
  const t0 = Date.now();
  try {
    const [allPoints, allDiags] = await Promise.all([
      db().pricePoints.toArray(),
      db().parserDiagnostics.toArray(),
    ]);
    const pricePlan = planCompaction(allPoints, t0);
    const diagPlan = planDiagnosticsPurge(allDiags, t0);

    let pricePointsRemoved = 0;
    let diagnosticsRemoved = 0;

    if (pricePlan.deleteIds.size > 0) {
      const ids = [...pricePlan.deleteIds];
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        await db().pricePoints.bulkDelete(ids.slice(i, i + CHUNK));
      }
      pricePointsRemoved = pricePlan.deleteIds.size;
    }

    if (diagPlan.deleteIds.size > 0) {
      const ids = [...diagPlan.deleteIds];
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        await db().parserDiagnostics.bulkDelete(ids.slice(i, i + CHUNK));
      }
      diagnosticsRemoved = diagPlan.deleteIds.size;
    }

    const result: MaintenanceResult = {
      pricePointsRemoved,
      diagnosticsRemoved,
      durationMs: Date.now() - t0,
    };
    await writeLastRunAt(Date.now());
    console.info(
      '[PriceWatch] maintenance done',
      `points-removed=${pricePointsRemoved}`,
      `diags-removed=${diagnosticsRemoved}`,
      `dt=${result.durationMs}ms`,
    );
    return result;
  } catch (err) {
    console.warn('[PriceWatch] maintenance failed', err);
    return null;
  } finally {
    runInFlight = false;
  }
}

export async function getMaintenanceStatus(): Promise<{ lastRunAt: number | null }> {
  const lastRunAt = await readLastRunAt();
  return { lastRunAt };
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
