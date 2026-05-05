import type { Parser } from '../base';
import { makeSpaWatcher } from '../base';
import { extractYandexMarketProduct, isYandexMarketProductPage } from './extract';
import { YM_SELECTORS } from './selectors';

function findAnchor(doc: Document): HTMLElement | null {
  const candidates: HTMLElement[] = [];

  for (const sel of YM_SELECTORS.priceAnchor) {
    candidates.push(...Array.from(doc.querySelectorAll<HTMLElement>(sel)));
  }
  // CSS-module hashed fallbacks.
  candidates.push(
    ...Array.from(doc.querySelectorAll<HTMLElement>('[class*="price" i]')),
  );
  // Last-resort: the product heading.
  candidates.push(...Array.from(doc.querySelectorAll<HTMLElement>('h1')));

  for (const el of candidates) {
    if (!el.isConnected) continue;
    let rect: DOMRect | null = null;
    try { rect = el.getBoundingClientRect(); } catch { /* ignore */ }
    if (rect && rect.width < 50 && rect.height < 10) continue;
    return el;
  }
  return null;
}

export const yandexMarketParser: Parser = {
  marketplace: 'yandex-market',
  version: 1,

  isProductPage(url) {
    return isYandexMarketProductPage(url);
  },

  parse(doc, url) {
    return extractYandexMarketProduct(doc, url);
  },

  extractAnchorElement(doc) {
    return findAnchor(doc);
  },

  watchSpa: makeSpaWatcher(),
};
