import type { Marketplace, ParsedProduct } from '@/shared/types';
import { extractNmFromUrl, fetchWbProductFromApi } from '@/parsers/wildberries/api';

export interface ExecutorOk {
  ok: true;
  parsed: ParsedProduct;
}

export interface ExecutorFail {
  ok: false;
  error: string;
}

export type ExecutorResult = ExecutorOk | ExecutorFail;

export interface ExecuteOptions {
  /**
   * When true, marketplaces without a public JSON API (Ozon, Yandex Market) are
   * refreshed by opening the URL in a hidden inactive tab and asking the
   * content script to parse the page on demand. Used for manual refresh; the
   * scheduler keeps `false` to avoid spawning tabs in the background.
   */
  allowHiddenTab?: boolean;
}

/**
 * Run a scheduled update for a single product.
 *
 * When `allowHiddenTab` is set, *all* marketplaces go through the hidden pinned
 * tab. For WB this is required to capture the WB-Wallet price — the public API
 * stopped surfacing it, and the wallet figure is now computed client-side and
 * read off the DOM by the content script's `enrich` augmentation.
 *
 * When `allowHiddenTab` is false (e.g. caller doesn't want a tab for any reason),
 * WB falls back to a direct API call (no wallet price), and Ozon / Y.Market report
 * `not_implemented:tab_refresh` so the scheduler can drop the task.
 */
export async function execute(
  marketplace: Marketplace,
  url: string,
  opts: ExecuteOptions = {},
): Promise<ExecutorResult> {
  if (opts.allowHiddenTab) return executeViaHiddenTab(url);
  switch (marketplace) {
    case 'wildberries':
      return executeWildberries(url);
    case 'ozon':
    case 'yandex-market':
      return { ok: false, error: 'not_implemented:tab_refresh' };
  }
}

async function executeWildberries(url: string): Promise<ExecutorResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  const nm = extractNmFromUrl(parsedUrl);
  if (nm == null) return { ok: false, error: 'no_nm_in_url' };

  try {
    const parsed = await fetchWbProductFromApi(nm, parsedUrl);
    if (!parsed) return { ok: false, error: 'api_returned_null' };
    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const HIDDEN_HASH = '#__pwHidden';
const HIDDEN_TAB_TIMEOUT_MS = 30_000;
const PROBE_RETRY_MS = 800;
const HIDDEN_TAB_STORAGE_KEY = 'pricewatch:hiddenTabId';
const HIDDEN_TAB_IDLE_ALARM = 'pricewatch:hidden-tab-idle-close';
const HIDDEN_TAB_IDLE_MINUTES = 1;

/** chrome-extension:// URL of the parked page (extension favicon + label). */
function parkedUrl(): string {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return 'about:blank';
  return chrome.runtime.getURL('parked.html');
}

// Single-flight: all refreshes share the same hidden tab, so concurrent
// updates would race on it. Queue them sequentially.
let inflightRefresh: Promise<ExecutorResult> | null = null;

function executeViaHiddenTab(url: string): Promise<ExecutorResult> {
  // Serialize: only one refresh navigates the shared hidden tab at a time.
  const prev = inflightRefresh ?? Promise.resolve(null);
  const next = prev.then(() => doRefreshViaHiddenTab(url));
  inflightRefresh = next.finally(() => {
    if (inflightRefresh === next) inflightRefresh = null;
  });
  return next;
}

async function doRefreshViaHiddenTab(url: string): Promise<ExecutorResult> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return { ok: false, error: 'tabs_api_unavailable' };
  }
  ensureIdleCloseAlarmListener();

  const finalUrl = url.replace(/#.*$/, '') + HIDDEN_HASH;
  console.info('[PriceWatch:exec] hidden refresh start', finalUrl);

  let tabId: number;
  let created: boolean;
  try {
    const handle = await getOrCreateHiddenTab();
    tabId = handle.tabId;
    created = handle.created;
  } catch (err) {
    console.warn('[PriceWatch:exec] could not get hidden tab', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  console.info('[PriceWatch:exec] hidden tab ready', { tabId, created });

  try {
    const loadedPromise = waitForTabCompleteForUrl(tabId, finalUrl, HIDDEN_TAB_TIMEOUT_MS);
    await chrome.tabs.update(tabId, { url: finalUrl, active: false });

    const loaded = await loadedPromise;
    if (!loaded) {
      console.warn('[PriceWatch:exec] tab load timeout', tabId);
      return { ok: false, error: 'tab_load_timeout' };
    }
    console.info('[PriceWatch:exec] tab complete, starting probe', tabId);

    const result = await probeWithRetry(tabId, HIDDEN_TAB_TIMEOUT_MS);
    console.info('[PriceWatch:exec] probe finished', {
      tabId,
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });

    // Park the pinned tab back on about:blank so the marketplace page doesn't
    // hang around in memory between refreshes.
    try {
      await chrome.tabs.update(tabId, { url: parkedUrl() });
    } catch {
      // tab may have been closed by user — next refresh will recreate.
    }

    return result;
  } catch (err) {
    console.warn('[PriceWatch:exec] hidden refresh exception', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // Debounce auto-close: each refresh resets the idle timer to N minutes.
    // If no refresh fires for that long, the alarm closes the pinned tab.
    rescheduleIdleCloseAlarm();
  }
}

interface HiddenTabHandle {
  tabId: number;
  /** True if we created the tab in this call (one-time appearance happens here). */
  created: boolean;
}

/**
 * Reuse a single pinned tab across refreshes. Pinned tabs sit at the far-left
 * of the tab strip as a tiny favicon, taking ~32px — much less intrusive than
 * a regular tab that takes the full strip slot. After first creation, every
 * subsequent refresh just calls `tabs.update` on the same tab, so the user
 * sees no visual change at all.
 *
 * Tab id is persisted in `chrome.storage.session` so it survives service-worker
 * restarts within the same browser session. If the user closes the tab
 * manually, we transparently recreate it on the next refresh.
 */
async function getOrCreateHiddenTab(): Promise<HiddenTabHandle> {
  const stored = await readStoredHiddenTabId();
  if (stored != null) {
    try {
      const tab = await chrome.tabs.get(stored);
      if (tab?.id != null) return { tabId: tab.id, created: false };
    } catch {
      // Tab was closed by the user (or never existed in this session).
    }
    await writeStoredHiddenTabId(null);
  }

  const tab = await chrome.tabs.create({
    url: parkedUrl(),
    active: false,
    pinned: true,
  });
  if (tab.id == null) throw new Error('hidden_tab_create_failed');
  await writeStoredHiddenTabId(tab.id);
  return { tabId: tab.id, created: true };
}

async function readStoredHiddenTabId(): Promise<number | null> {
  try {
    const r = await chrome.storage.session.get(HIDDEN_TAB_STORAGE_KEY);
    const v = r[HIDDEN_TAB_STORAGE_KEY];
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

async function writeStoredHiddenTabId(id: number | null): Promise<void> {
  try {
    if (id == null) await chrome.storage.session.remove(HIDDEN_TAB_STORAGE_KEY);
    else await chrome.storage.session.set({ [HIDDEN_TAB_STORAGE_KEY]: id });
  } catch {
    // session storage may be unavailable in tests
  }
}

/**
 * Wait for the tab to finish loading the specific target URL. Used by the
 * about:blank → product-url two-step flow to avoid resolving on the about:blank
 * `complete` event that happens before navigation is even started.
 */
function waitForTabCompleteForUrl(
  tabId: number,
  expectedUrl: string,
  timeoutMs: number,
): Promise<boolean> {
  // Strip the hash for matching — Chrome may report tab.url without the fragment.
  const expectedBase = expectedUrl.replace(/#.*$/, '');
  return new Promise((resolve) => {
    const listener = (
      id: number,
      change: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (id !== tabId) return;
      if (change.status !== 'complete') return;
      const tabUrl = (tab.url ?? '').replace(/#.*$/, '');
      if (tabUrl && tabUrl.startsWith(expectedBase)) {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function probeWithRetry(tabId: number, timeoutMs: number): Promise<ExecutorResult> {
  const start = Date.now();
  let lastErr = 'no_response';
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    try {
      const resp = (await chrome.tabs.sendMessage(tabId, { type: 'pricewatch:probe' })) as
        | { ok: true; parsed: ParsedProduct }
        | { ok: false; reason: string }
        | undefined;
      if (resp && resp.ok) {
        console.info('[PriceWatch:exec] probe ok', { tabId, attempt, price: resp.parsed.currentPrice });
        return { ok: true, parsed: resp.parsed };
      }
      if (resp && !resp.ok) {
        lastErr = resp.reason || 'probe_failed';
        console.info('[PriceWatch:exec] probe not ready', { tabId, attempt, reason: lastErr });
      } else {
        lastErr = 'no_response_undefined';
        console.info('[PriceWatch:exec] probe undefined response', { tabId, attempt });
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.info('[PriceWatch:exec] probe sendMessage threw', { tabId, attempt, lastErr });
    }
    await sleep(PROBE_RETRY_MS);
  }
  return { ok: false, error: lastErr };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Module-init: register the idle-close alarm listener exactly once at SW boot.
 *
 * MV3 alarms wake the service worker when they fire. The listener must be
 * attached *synchronously* during module evaluation — if we wire it lazily
 * (inside doRefreshViaHiddenTab), a fresh SW that wakes specifically because
 * of the alarm would miss the first event and the tab would never close.
 */
if (typeof chrome !== 'undefined' && chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== HIDDEN_TAB_IDLE_ALARM) return;
    const id = await readStoredHiddenTabId();
    if (id == null) return;
    try {
      await chrome.tabs.remove(id);
      console.info('[PriceWatch:exec] hidden tab auto-closed (idle)');
    } catch {
      // already closed by the user
    }
    await writeStoredHiddenTabId(null);
  });
}

function ensureIdleCloseAlarmListener(): void {
  // No-op kept for the existing call site; listener is registered at module init.
}

/** Reset the idle-close countdown — call on every refresh that uses the tab. */
function rescheduleIdleCloseAlarm(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  // chrome.alarms.create with the same name overrides the existing one.
  chrome.alarms.create(HIDDEN_TAB_IDLE_ALARM, { delayInMinutes: HIDDEN_TAB_IDLE_MINUTES });
}
