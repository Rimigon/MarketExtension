import type { Parser } from '../base';
import { makeSpaWatcher } from '../base';
import { extractOzonProduct, isOzonProductPage } from './extract';
import { OZON_SELECTORS } from './selectors';

/**
 * Anchor strategy: pin the «Следить» button + cross-marketplace row directly
 * under the price block. We try every price-widget variant Ozon ships across
 * A/B layouts in turn; the first one that's rendered and non-trivially sized
 * wins.
 *
 * We deliberately do NOT fall back to the heading widget or `h1` here. On
 * SPA navigations Ozon hydrates the heading first and the price block a beat
 * later — if we accepted a heading fallback, the button would flicker under
 * the title and then re-inject under the price once the next MutationObserver
 * tick fired (the "через раз под названием то под ценой" bug). Returning null
 * keeps the button hidden until a real price anchor exists.
 *
 * Size filter is intentionally lax (≥ 20px wide, ≥ 10px tall) so thin price
 * widgets during partial hydration aren't rejected.
 */
function findInjectionAnchor(doc: Document): HTMLElement | null {
  const candidates: HTMLElement[] = OZON_SELECTORS.priceAnchor.flatMap((sel) =>
    Array.from(doc.querySelectorAll<HTMLElement>(sel)),
  );

  for (const el of candidates) {
    let rect: DOMRect | null = null;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      continue;
    }
    if (!rect || rect.width < 20 || rect.height < 10) continue;
    return el;
  }
  return null;
}

export const ozonParser: Parser = {
  marketplace: 'ozon',
  version: 3,

  isProductPage(url) {
    return isOzonProductPage(url);
  },

  parse(doc, url) {
    return extractOzonProduct(doc, url);
  },

  extractAnchorElement(doc) {
    return findInjectionAnchor(doc);
  },

  watchSpa: makeSpaWatcher(),
};
