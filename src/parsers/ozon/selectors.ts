/**
 * CSS selectors for Ozon product card. Multiple fallbacks are tried in order.
 * Ozon ships A/B variants and partial-DOM updates, so single selectors are never enough.
 */
export const OZON_SELECTORS = {
  /** Anchor for inserting our «Track» button. Order matters — first match wins. */
  priceAnchor: [
    '[data-widget="webPrice"]',
    '[data-widget="webStickyProducts"]',
    '[data-widget="webProductHeading"]',
  ],
  /**
   * Where to search for current price text. We walk all leaf-text nodes inside these blocks
   * looking for `«… ₽»` patterns; see extract.ts → extractPricesFromBlock().
   * Listed in the order we'd like to *prefer* — main hero block first, sticky/aggregate fallbacks last.
   */
  priceBlock: [
    '[data-widget="webPrice"]',
    '[data-widget="webStickyProducts"]',
    '[data-widget="webOzonAccountPrice"]',
    '[data-widget="webProductMainPrice"]',
  ],
  title: [
    '[data-widget="webProductHeading"] h1',
    'h1[itemprop="name"]',
    'h1[data-widget*="ProductHeading"]',
    'h1',
  ],
  image: [
    '[data-widget="webGallery"] img',
    'img[itemprop="image"]',
    'div[data-widget="webGallery"] picture img',
  ],
  rating: ['[data-widget="webSingleProductScore"] [data-rating]'],
  reviewCount: [
    '[data-widget="webReviewProductScore"] a',
    '[data-widget="webSingleProductScore"] a[href*="/reviews/"]',
    'a[href*="/reviews/"]',
  ],
  description: [
    '[data-widget="webDescription"]',
    '[data-widget="webShortDescription"]',
    '#section-description',
    '[data-widget="webProductHeading"] ~ section',
  ],
  characteristics: [
    '[data-widget="webCharacteristics"]',
    '[data-widget="webShortCharacteristics"]',
    '#section-characteristics',
  ],
} as const;
