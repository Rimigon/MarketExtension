/**
 * CSS selectors for Wildberries product card. Multiple fallbacks tried in order.
 * WB ships partial-DOM updates and occasional class renames — keep alternates.
 */
export const WB_SELECTORS = {
  /** Where the «Track» button is anchored. First match wins. */
  priceAnchor: [
    '.product-page__price-block',
    '.product-page__price',
    '.product-page__title',
  ],
  priceBlock: [
    '.product-page__price-block',
    '.j-price-block',
  ],
  finalPrice: [
    // Wallet price first — it's the prominent figure on the page (lowest visible tier).
    // 2025+ scoped camelCase, then legacy hyphenated BEM.
    '[class*="priceBlockWalletPrice"]',
    '[class*="WalletPrice" i]',
    '.price-block__wallet-price',
    'span.wallet-price',
    '.price-block__final-price',
    'ins.price-block__final-price',
  ],
  oldPrice: [
    '[class*="priceBlockOldPrice"]',
    '[class*="OldPrice" i]',
    '.price-block__old-price del',
    '.price-block__old-price',
    'del.price-block__old-price',
  ],
  title: [
    '.product-page__title',
    'h1.product-page__title',
    'h1[itemprop="name"]',
    'h1',
  ],
  brand: [
    '.product-page__header-brand',
    'a.product-page__header-brand',
    '[data-link*="brand"]',
  ],
  image: [
    '.photo-zoom__preview',
    '.product-page__gallery img',
    'img[itemprop="image"]',
  ],
  rating: [
    '.product-review__rating',
    '[data-link*="rating"]',
  ],
  reviewCount: [
    '.product-review__count-review',
    'a[href*="#reviews"]',
    '[data-link*="ratingValuesCount"]',
  ],
  description: [
    '.product-page__description',
    '.collapsable__description',
    'section.product-details__description',
  ],
  characteristics: [
    '.product-params',
    '.product-page__params',
    'table.product-params__table',
  ],
} as const;
