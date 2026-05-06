import type { Parser } from '../base';
import { makeSpaWatcher } from '../base';
import { extractOzonProduct, isOzonProductPage } from './extract';
import { OZON_SELECTORS } from './selectors';

/**
 * Anchor strategy: place the «Track price» button right under the product title.
 *
 * Order of preference:
 *   1. Heading widgets (`webProductHeading` and the H1 it contains).
 *   2. Bare `h1` as the last-resort fallback.
 *   3. Price block (`webPrice` and friends) — used only when the heading isn't
 *      rendered yet (skeleton / regional variants).
 *
 * Each candidate must be on screen with non-trivial size — Ozon ships A/B variants where
 * the same selector can match invisible/empty elements.
 */
function findInjectionAnchor(doc: Document): HTMLElement | null {
  const candidates: HTMLElement[] = [
    ...Array.from(doc.querySelectorAll<HTMLElement>('[data-widget="webProductHeading"]')),
    ...Array.from(doc.querySelectorAll<HTMLElement>('h1[data-widget*="ProductHeading"]')),
    ...Array.from(doc.querySelectorAll<HTMLElement>('h1[itemprop="name"]')),
    ...Array.from(doc.querySelectorAll<HTMLElement>('h1')),
    ...OZON_SELECTORS.priceAnchor.flatMap((sel) =>
      Array.from(doc.querySelectorAll<HTMLElement>(sel)),
    ),
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
