import type { Parser } from '../base';
import { makeSpaWatcher } from '../base';
import { extractOzonProduct, isOzonProductPage } from './extract';
import { OZON_SELECTORS } from './selectors';

/**
 * Anchor strategy: prefer placing the «Track price» button right after the price block,
 * which is what the user expects visually (button under the price).
 *
 * Order of preference:
 *   1. Price-block widgets (`webPrice`, sticky/account/main fallbacks).
 *   2. Heading widgets — used when the price block isn't yet rendered (skeleton state)
 *      or the user is in a region where pricing is suppressed.
 *   3. Bare `h1` as the last-resort fallback.
 *
 * Each candidate must be on screen with non-trivial size — Ozon ships A/B variants where
 * the same selector can match invisible/empty elements.
 */
function findInjectionAnchor(doc: Document): HTMLElement | null {
  const candidates: HTMLElement[] = [
    ...OZON_SELECTORS.priceAnchor.flatMap((sel) =>
      Array.from(doc.querySelectorAll<HTMLElement>(sel)),
    ),
    ...Array.from(doc.querySelectorAll<HTMLElement>('[data-widget="webProductHeading"]')),
    ...Array.from(doc.querySelectorAll<HTMLElement>('h1[data-widget*="ProductHeading"]')),
    ...Array.from(doc.querySelectorAll<HTMLElement>('h1[itemprop="name"]')),
    ...Array.from(doc.querySelectorAll<HTMLElement>('h1')),
  ];

  for (const el of candidates) {
    let rect: DOMRect | null = null;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      continue;
    }
    if (!rect || rect.width < 50 || rect.height < 10) continue;
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
