import type { Parser } from '../base';
import { makeSpaWatcher } from '../base';
import { extractOzonProduct, isOzonProductPage } from './extract';

/**
 * Anchor strategy: ALWAYS pin the «Track price» button right after the product heading (h1).
 * This is the most stable spot on Ozon's card — h1 isn't re-rendered when the user picks a color
 * or size variant, doesn't get duplicated in sticky bars, and has a consistent layout across A/B.
 *
 * Order of preference:
 *   1. `[data-widget="webProductHeading"]` — the canonical heading block.
 *   2. Bare `h1` element — last-resort fallback if the data-widget naming changes.
 */
function findHeadingAnchor(doc: Document): HTMLElement | null {
  const candidates = [
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
    return findHeadingAnchor(doc);
  },

  watchSpa: makeSpaWatcher(),
};
