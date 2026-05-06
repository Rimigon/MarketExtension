import type { Parser } from '@/parsers/base';
import type { ParsedProduct } from '@/shared/types';
import { sendRpc } from '@/shared/rpc';
import { injectTrackButton, teardownInjection } from './injector';

const HOST_ID = 'pricewatch-track-host';

export interface RunOptions {
  /**
   * Optional async data source that bypasses the DOM parser. Useful when the marketplace
   * exposes a public API (e.g. WB's card.wb.ru). Resolves to null → fall back to parser.parse.
   * Result is cached by canonical URL to avoid re-fetching on every mutation tick.
   */
  enrich?: (url: URL) => Promise<ParsedProduct | null>;
  /**
   * When true, skip in-page button injection and the MutationObserver loop.
   * Content script still answers popup-bridge (`pricewatch:requestAdd`) and
   * hidden-refresh (`pricewatch:probe`) messages. Used for marketplaces where
   * the on-page button is unreliable (e.g. Ozon — heavy SPA + hashed classes).
   */
  noInject?: boolean;
}

/**
 * Generic content-script bootstrap shared by every marketplace.
 * Wires up a parser to: detect product pages, find the inject anchor, render TrackButton in Shadow DOM,
 * and re-inject on SPA navigation / DOM mutations.
 */
export function runContentScript(parser: Parser, label: string, opts: RunOptions = {}): void {
  const prefix = `[PriceWatch:${label}]`;
  console.info(`${prefix} content script loaded`, location.href);

  // Hidden refresh: background opened this tab to read the price without UI.
  // Skip the inject loop / passive sync entirely; just answer probe messages.
  if (location.hash === '#__pwHidden') {
    console.info(`${prefix} hidden mode — probe-only`);
    registerProbeHandler(parser, opts, prefix);
    return;
  }

  // No-inject mode: don't paint a button on the page (popup-only marketplaces).
  // We still register message handlers so popup "Add" and hidden-refresh keep working.
  if (opts.noInject) {
    console.info(`${prefix} inject disabled — message handlers only`);
    registerNoInjectHandlers(parser, opts, prefix);
    return;
  }

  let observer: MutationObserver | null = null;
  let injecting = false;
  let checkScheduled = false;
  let currentAnchor: HTMLElement | null = null;
  let attempt = 0;
  let lastDiag = '';
  let cachedEnrich: { canonicalUrl: string; product: ParsedProduct } | null = null;
  let enrichInFlight: Promise<ParsedProduct | null> | null = null;
  let lastPassiveSync: { canonicalUrl: string; at: number } | null = null;
  const PASSIVE_SYNC_COOLDOWN_MS = 30_000;

  function diag(msg: string, ...rest: unknown[]): void {
    // De-dupe noisy messages from the mutation-observer loop — log only when state changes.
    if (msg === lastDiag) return;
    lastDiag = msg;
    console.info(prefix, msg, ...rest);
  }

  function getHost(): HTMLElement | null {
    return document.getElementById(HOST_ID);
  }

  function isInjected(): boolean {
    const host = getHost();
    return Boolean(host && host.isConnected);
  }

  function isCorrectlyPlaced(): boolean {
    const host = getHost();
    if (!host || !host.isConnected || !currentAnchor || !currentAnchor.isConnected) return false;
    return host.previousElementSibling === currentAnchor;
  }

  async function getInitialProductFor(parsed: ParsedProduct) {
    try {
      const resp = await sendRpc('product/getByCanonical', { canonicalUrl: parsed.canonicalUrl });
      return resp.product;
    } catch (err) {
      console.warn(`[PriceWatch] ${label} getByCanonical failed`, err);
      return null;
    }
  }

  async function getParsedProduct(url: URL): Promise<ParsedProduct | null> {
    if (opts.enrich) {
      // Cached — same URL, reuse.
      if (cachedEnrich && cachedEnrich.canonicalUrl === url.pathname) return cachedEnrich.product;
      // In-flight — share the promise so multiple ticks don't fan out.
      if (!enrichInFlight) {
        enrichInFlight = opts
          .enrich(url)
          .catch((err) => {
            console.warn(prefix, 'enrich failed', err);
            return null;
          })
          .finally(() => {
            enrichInFlight = null;
          });
      }
      const enriched = await enrichInFlight;
      if (enriched) {
        cachedEnrich = { canonicalUrl: url.pathname, product: enriched };
        return enriched;
      }
    }
    return parser.parse(document, url);
  }

  async function tryInject(): Promise<void> {
    if (injecting) return;
    attempt++;

    const url = new URL(location.href);
    if (!parser.isProductPage(url)) {
      diag('not a product URL — skipping', url.pathname);
      return;
    }

    const anchor = parser.extractAnchorElement(document);
    if (!anchor) {
      diag(`no anchor element found yet (attempt #${attempt})`);
      // Every 8th try, dump a DOM snapshot so the user can identify the right selectors.
      if (attempt % 8 === 0) {
        const h1s = Array.from(document.querySelectorAll('h1')).slice(0, 3).map((el) => ({
          text: (el.textContent ?? '').slice(0, 80).trim(),
          className: (el.className as unknown as string) || '',
        }));
        const priceLikes = Array.from(document.querySelectorAll('[class*="price" i], [data-auto*="price" i]'))
          .slice(0, 5)
          .map((el) => ({
            tag: el.tagName,
            className: (el.className as unknown as string) || '',
            dataAuto: (el as HTMLElement).dataset?.auto ?? '',
            text: (el.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60).trim(),
          }));
        console.info(prefix, 'DOM probe (anchor missing)', { h1s, priceLikes });
      }
      return;
    }

    if (isInjected() && currentAnchor === anchor && isCorrectlyPlaced()) return;

    const parsed = await getParsedProduct(url);
    if (!parsed) {
      diag('parser returned null (page not parseable / captcha)', { url: url.pathname });
      return;
    }
    if (parsed.currentPrice == null) {
      diag('parsed but currentPrice is null — skipping inject', {
        title: parsed.title,
        status: parsed.parserStatus,
      });
      return;
    }

    diag('injecting TrackButton', {
      title: parsed.title,
      currentPrice: parsed.currentPrice,
      anchorTag: anchor.tagName,
      anchorClass: (anchor.className as unknown as string) || '(none)',
    });

    injecting = true;
    try {
      const initialProduct = await getInitialProductFor(parsed);
      teardownInjection();
      injectTrackButton({ anchor, parsed, initialProduct });
      currentAnchor = anchor;
      lastDiag = 'injected'; // reset dedup so re-checks log fresh state
      // Passive sync: товар уже отслеживается → молча обновим product + запишем точку,
      // если цена изменилась. Кулдаун 30с защищает от повторных вызовов на SPA-mutation.
      if (initialProduct && parsed.parserStatus !== 'failed' && parsed.currentPrice != null) {
        const now = Date.now();
        const syncedRecently =
          lastPassiveSync &&
          lastPassiveSync.canonicalUrl === parsed.canonicalUrl &&
          now - lastPassiveSync.at < PASSIVE_SYNC_COOLDOWN_MS;
        if (!syncedRecently) {
          lastPassiveSync = { canonicalUrl: parsed.canonicalUrl, at: now };
          void sendRpc('product/add', { parsed, source: 'page' }).catch((err) =>
            console.warn(prefix, 'passive sync failed', err),
          );
        }
      }
    } finally {
      injecting = false;
    }
  }

  function runCheck(): void {
    if (!isInjected() || !isCorrectlyPlaced()) {
      void tryInject();
    }
  }

  function scheduleCheck(): void {
    if (checkScheduled) return;
    checkScheduled = true;
    setTimeout(() => {
      checkScheduled = false;
      runCheck();
    }, 150);
  }

  function startObserving(): void {
    observer?.disconnect();
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', startObserving, { once: true });
      return;
    }

    void tryInject();

    observer = new MutationObserver(scheduleCheck);
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(scheduleCheck, 2000);
  }

  startObserving();

  const stopWatchingSpa = parser.watchSpa(() => {
    teardownInjection();
    currentAnchor = null;
    cachedEnrich = null;
    setTimeout(() => startObserving(), 600);
  });

  window.addEventListener('beforeunload', () => {
    observer?.disconnect();
    stopWatchingSpa();
  });

  // Expose a manual probe for the user: in DevTools console run `__pricewatch.probe()` to see
  // exactly what the parser sees on the page right now.
  type Probe = {
    isProductPage: boolean;
    anchor: { tag: string; className: string; text: string } | null;
    parsed: ReturnType<typeof parser.parse>;
  };
  const probe = (): Probe => {
    const url = new URL(location.href);
    const a = parser.extractAnchorElement(document);
    return {
      isProductPage: parser.isProductPage(url),
      anchor: a
        ? {
            tag: a.tagName,
            className: (a.className as unknown as string) || '',
            text: (a.textContent ?? '').slice(0, 80).trim(),
          }
        : null,
      parsed: parser.parse(document, url),
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__pricewatch = { probe, label, retry: () => tryInject() };

  async function addCurrentPageDirectly(): Promise<{ ok: boolean; reason?: string }> {
    const url = new URL(location.href);
    if (!parser.isProductPage(url)) return { ok: false, reason: 'not_product_page' };
    const parsed = await getParsedProduct(url);
    if (!parsed) return { ok: false, reason: 'parser_failed' };
    if (parsed.currentPrice == null) return { ok: false, reason: 'no_price' };
    try {
      const resp = await sendRpc('product/add', { parsed, source: 'popup' });
      if (!resp.ok) return { ok: false, reason: resp.error };
      // Re-check inject so the page now shows the «отслеживается» state.
      void tryInject();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (resp?: unknown) => void) => {
      if (!message || typeof message !== 'object' || !('type' in message)) {
        return undefined;
      }
      const type = (message as { type: string }).type;

      if (type === 'pricewatch:probe') {
        void probeOnce(parser, opts).then((result) => sendResponse(result));
        return true;
      }

      if (type !== 'pricewatch:requestAdd') return undefined;

      // Try clicking the existing injected button first (preserves onChange semantics).
      const host = getHost();
      const realButton = host?.shadowRoot?.querySelector<HTMLButtonElement>('button');
      if (realButton) {
        realButton.click();
        sendResponse({ ok: true, via: 'button' });
        return true;
      }

      // No button injected — go straight to RPC and report the result back.
      void addCurrentPageDirectly().then((result) => {
        diag(`popup-add result`, result);
        sendResponse({ ...result, via: 'direct' });
      });
      return true; // keep the channel open for async sendResponse
    },
  );
}

/**
 * No-inject mode: marketplace doesn't get a TrackButton on the page,
 * but popup-add and hidden-refresh keep working. Used for Ozon where
 * the in-page anchor is unreliable across A/B variants.
 */
function registerNoInjectHandlers(parser: Parser, opts: RunOptions, prefix: string): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (resp?: unknown) => void) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return undefined;
      const type = (message as { type: string }).type;

      if (type === 'pricewatch:probe') {
        void probeOnce(parser, opts).then((result) => {
          if (!result.ok) console.info(prefix, 'probe not ready', result.reason);
          sendResponse(result);
        });
        return true;
      }

      if (type === 'pricewatch:requestAdd') {
        void probeOnce(parser, opts).then(async (probe) => {
          if (!probe.ok) {
            sendResponse({ ok: false, reason: probe.reason, via: 'direct' });
            return;
          }
          try {
            const resp = await sendRpc('product/add', { parsed: probe.parsed, source: 'popup' });
            if (!resp.ok) sendResponse({ ok: false, reason: resp.error, via: 'direct' });
            else sendResponse({ ok: true, via: 'direct' });
          } catch (err) {
            sendResponse({
              ok: false,
              reason: err instanceof Error ? err.message : String(err),
              via: 'direct',
            });
          }
        });
        return true;
      }

      return undefined;
    },
  );
}

/**
 * Probe-only handler used in hidden-tab refresh mode.
 * Background opens the URL with `#__pwHidden`, content script answers
 * `pricewatch:probe` with the current parsed product (or a `not_ready`
 * reason — the background will retry until it becomes ready or times out).
 */
function registerProbeHandler(parser: Parser, opts: RunOptions, prefix: string): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (resp?: unknown) => void) => {
      if (
        !message ||
        typeof message !== 'object' ||
        !('type' in message) ||
        (message as { type: string }).type !== 'pricewatch:probe'
      ) {
        return undefined;
      }
      void probeOnce(parser, opts).then((result) => {
        if (!result.ok) console.info(prefix, 'probe not ready', result.reason);
        sendResponse(result);
      });
      return true;
    },
  );
}

async function probeOnce(
  parser: Parser,
  opts: RunOptions,
): Promise<{ ok: true; parsed: ParsedProduct } | { ok: false; reason: string }> {
  const url = new URL(location.href);
  if (!parser.isProductPage(url)) return { ok: false, reason: 'not_product_page' };
  let parsed: ParsedProduct | null = null;
  try {
    if (opts.enrich) {
      parsed = await opts.enrich(url);
    }
  } catch {
    parsed = null;
  }
  if (!parsed) parsed = parser.parse(document, url);
  if (!parsed) return { ok: false, reason: 'parser_failed' };
  if (parsed.parserStatus === 'failed') return { ok: false, reason: 'parser_status_failed' };
  if (parsed.currentPrice == null) return { ok: false, reason: 'no_price' };
  return { ok: true, parsed };
}
