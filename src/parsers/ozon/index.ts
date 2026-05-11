import type { Parser } from '../base';
import { makeSpaWatcher } from '../base';
import { extractOzonProduct, isOzonProductPage } from './extract';
import { OZON_SELECTORS } from './selectors';

/**
 * Anchor strategy: place the «Track price» button right under the price block,
 * because that's where the user's attention is when deciding whether to track.
 *
 * Order of preference:
 *   1. Price widgets (`webPrice` and friends) — primary target.
 *   2. Heading widgets (`webProductHeading` / H1) — fallback when the price
 *      block hasn't hydrated yet (skeleton / regional variants).
 *   3. Bare `h1` as last resort.
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
