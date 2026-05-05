import type { Parser } from '../base';
import { makeSpaWatcher } from '../base';
import { extractWildberriesProduct, isWildberriesProductPage } from './extract';
import { WB_SELECTORS } from './selectors';

/**
 * Anchor strategy: try the documented price block selectors first; if WB ships hashed CSS modules
 * (which they increasingly do), fall through to a generic `h1`. h1 is the most stable thing on a
 * product page — even if the entire price block is renamed, the title is always there.
 */
function findAnchor(doc: Document): HTMLElement | null {
  const candidates: HTMLElement[] = [];

  for (const sel of WB_SELECTORS.priceAnchor) {
    candidates.push(...Array.from(doc.querySelectorAll<HTMLElement>(sel)));
  }
  // Hashed CSS module fallbacks — match by class substring.
  candidates.push(
    ...Array.from(doc.querySelectorAll<HTMLElement>('[class*="priceBlock"], [class*="price-block"]')),
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

export const wildberriesParser: Parser = {
  marketplace: 'wildberries',
  version: 1,

  isProductPage(url) {
    return isWildberriesProductPage(url);
  },

  parse(doc, url) {
    return extractWildberriesProduct(doc, url);
  },

  extractAnchorElement(doc) {
    return findAnchor(doc);
  },

  watchSpa: makeSpaWatcher(),
};
