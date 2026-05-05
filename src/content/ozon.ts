import { ozonParser } from '@/parsers/ozon';
import { sendRpc } from '@/shared/rpc';
import { injectTrackButton, teardownInjection } from './injector';
import type { ParsedProduct } from '@/shared/types';

console.debug('[PriceWatch] ozon content script loaded');

const HOST_ID = 'pricewatch-track-host';

let observer: MutationObserver | null = null;
let injecting = false;
let checkScheduled = false;
let currentAnchor: HTMLElement | null = null;

function getHost(): HTMLElement | null {
  return document.getElementById(HOST_ID);
}

function isInjected(): boolean {
  const host = getHost();
  return Boolean(host && host.isConnected);
}

/**
 * Returns true only if our host is still the immediate next sibling of the heading anchor.
 * If Ozon re-rendered the heading subtree (rare) or the host got moved, this fails and we re-inject.
 */
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
    console.warn('[PriceWatch] getByCanonical failed', err);
    return null;
  }
}

async function tryInject(): Promise<void> {
  if (injecting) return;

  const url = new URL(location.href);
  if (!ozonParser.isProductPage(url)) return;

  const anchor = ozonParser.extractAnchorElement(document);
  if (!anchor) return;

  // Already injected and correctly anchored? Nothing to do.
  if (isInjected() && currentAnchor === anchor && isCorrectlyPlaced()) return;

  const parsed = ozonParser.parse(document, url);
  if (!parsed || parsed.currentPrice == null) return;

  injecting = true;
  try {
    const initialProduct = await getInitialProductFor(parsed);
    teardownInjection();
    injectTrackButton({ anchor, parsed, initialProduct });
    currentAnchor = anchor;
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

  // Belt-and-braces: rare reflow-only changes (no DOM mutation, e.g. CSS-driven sticky toggle)
  // are caught by a low-frequency timer.
  setInterval(scheduleCheck, 2000);
}

startObserving();

const stopWatchingSpa = ozonParser.watchSpa(() => {
  teardownInjection();
  currentAnchor = null;
  setTimeout(() => startObserving(), 600);
});

window.addEventListener('beforeunload', () => {
  observer?.disconnect();
  stopWatchingSpa();
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    (message as { type: string }).type === 'pricewatch:requestAdd'
  ) {
    if (!isInjected()) {
      void tryInject();
      return;
    }
    const host = getHost();
    const realButton = host?.shadowRoot?.querySelector<HTMLButtonElement>('button');
    realButton?.click();
  }
  return undefined;
});
