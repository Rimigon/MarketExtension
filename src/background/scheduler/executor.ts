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
const HIDDEN_TAB_TIMEOUT_MS = 45_000;
/** Soft window we wait for the first `complete` event on the marketplace host
 *  before falling back to immediate probing. Most pages settle in under 5s;
 *  giving up early is fine because the probe loop will keep trying anyway. */
const NAV_WARMUP_MS = 8_000;
/** Minimum budget reserved for the probe loop after the warm-up wait, so we
 *  never start probing with only a few hundred ms left. */
const MIN_PROBE_BUDGET_MS = 20_000;
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
    // Watcher resolves on the *first* tab `complete` event for our marketplace
    // host (with www. normalized) — used only as a soft warm-up signal so the
    // very first probes don't race the parked.html teardown. Falls back to
    // false on tab close / timeout, but that no longer aborts the refresh —
    // probeWithRetry below has its own budget and is the authoritative signal.
    let expectedHost = '';
    try { expectedHost = stripWww(new URL(finalUrl).host); } catch { /* noop */ }
    const navStartedAt = Date.now();
    const loadedPromise = waitForAnyMarketplaceComplete(tabId, expectedHost, NAV_WARMUP_MS);
    await chrome.tabs.update(tabId, { url: finalUrl, active: false });

    const loaded = await loadedPromise;
    if (loaded) {
      console.info('[PriceWatch:exec] tab complete, starting probe', tabId);
    } else {
      console.info(
        '[PriceWatch:exec] no complete signal yet — probing anyway',
        { tabId, waited: Date.now() - navStartedAt },
      );
    }

    // probeWithRetry retries every PROBE_RETRY_MS for the remaining budget.
    // Content scripts register their `pricewatch:probe` handler as soon as they
    // load on the marketplace page; a successful response *is* "page ready".
    // Errors prior to that (e.g. "Receiving end does not exist") are silently
    // retried until either a real response arrives or we exhaust the timeout.
    const remaining = Math.max(
      MIN_PROBE_BUDGET_MS,
      HIDDEN_TAB_TIMEOUT_MS - (Date.now() - navStartedAt),
    );
    const result = await probeWithRetry(tabId, remaining);
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
 * Resolves on the first `complete` event for the given tab whose URL lives on
 * the marketplace host (with `www.` normalized). Used purely as a soft warm-up
 * signal: we don't want to fire the very first probe while the tab is still on
 * parked.html. Resolving false on timeout/close is *not* fatal — the caller
 * proceeds to probe anyway, since the marketplace content script registers its
 * `pricewatch:probe` handler as soon as it loads, which is the authoritative
 * signal that the page is parseable.
 *
 * URL pathname intentionally NOT compared — marketplaces redirect to canonical
 * URLs (Ozon strips `?asb=...`, sometimes mutates the slug; WB toggles `www.`)
 * and a stricter check produced false-negative `tab_load_timeout`s for legit
 * fully-loaded pages.
 */
function waitForAnyMarketplaceComplete(
  tabId: number,
  expectedHost: string,
  timeoutMs: number,
): Promise<boolean> {
  if (!expectedHost) return Promise.resolve(false);
  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(updatedListener);
      chrome.tabs.onRemoved.removeListener(removedListener);
      clearTimeout(timer);
    };
    const updatedListener = (
      id: number,
      change: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (id !== tabId) return;
      if (change.status !== 'complete') return;
      if (!tab.url) return;
      let actual: URL;
      try {
        actual = new URL(tab.url);
      } catch {
        return;
      }
      // Skip parked.html (chrome-extension://) and any non-http navigation.
      if (actual.protocol !== 'http:' && actual.protocol !== 'https:') return;
      if (stripWww(actual.host) !== expectedHost) return;
      cleanup();
      resolve(true);
    };
    const removedListener = (closedId: number) => {
      if (closedId !== tabId) return;
      cleanup();
      resolve(false);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(updatedListener);
    chrome.tabs.onRemoved.addListener(removedListener);
  });
}

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Reasons returned by `probeOnce` in run.ts that mean «the page is loaded and
 * we have a final verdict — retrying won't change the answer». Two flavours:
 *
 *  - HARD terminal: URL itself is the problem (`not_product_page`) or parser
 *    explicitly reported failure (`parser_status_failed`). Bail out instantly.
 *  - SOFT terminal: parser saw the page but couldn't extract a price
 *    (`parser_failed`, `no_price`). Could be a real delisting, but could also
 *    be a hydration race — WB's wallet element renders 1–4s after the
 *    document `complete` event, and Ozon SPAs sometimes inject the price
 *    block late. Give exactly one more probe after a longer settle delay,
 *    then accept the verdict.
 */
const HARD_TERMINAL_REASONS = new Set(['not_product_page', 'parser_status_failed']);
const SOFT_TERMINAL_REASONS = new Set(['parser_failed', 'no_price']);
const SOFT_TERMINAL_SETTLE_MS = 3_000;

async function probeWithRetry(tabId: number, timeoutMs: number): Promise<ExecutorResult> {
  const start = Date.now();
  let lastErr = 'no_response';
  let attempt = 0;
  let softTerminalSeenAt = 0;

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
        if (HARD_TERMINAL_REASONS.has(lastErr)) {
          console.info('[PriceWatch:exec] probe terminal (hard)', { tabId, attempt, reason: lastErr });
          return { ok: false, error: lastErr };
        }
        if (SOFT_TERMINAL_REASONS.has(lastErr)) {
          // First soft-terminal: arm the settle timer and keep retrying. After
          // SOFT_TERMINAL_SETTLE_MS has elapsed AND we still see the same
          // soft-terminal reason, accept it as final. This catches hydration
          // races without burning the full 45s budget on truly delisted items.
          if (softTerminalSeenAt === 0) {
            softTerminalSeenAt = Date.now();
            console.info('[PriceWatch:exec] probe soft-terminal — waiting for hydration', {
              tabId,
              attempt,
              reason: lastErr,
            });
          } else if (Date.now() - softTerminalSeenAt >= SOFT_TERMINAL_SETTLE_MS) {
            console.info('[PriceWatch:exec] probe soft-terminal settled', {
              tabId,
              attempt,
              reason: lastErr,
              waited: Date.now() - softTerminalSeenAt,
            });
            return { ok: false, error: lastErr };
          }
          // else: keep probing — same reason re-observed but still inside the
          // settle window.
        } else {
          // Different transient response — reset soft-terminal arm.
          softTerminalSeenAt = 0;
          console.info('[PriceWatch:exec] probe not ready', { tabId, attempt, reason: lastErr });
        }
      } else {
        lastErr = 'no_response_undefined';
        softTerminalSeenAt = 0;
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
