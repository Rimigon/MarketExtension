/**
 * CSS selectors for Yandex Market product card. Yandex frequently renames
 * `data-baobab-name` values — keep multiple alternates per field.
 */
export const YM_SELECTORS = {
  /** Anchor for the «Track» button. */
  priceAnchor: [
    '[data-zone-name="price"]',
    '[data-zone-name="HeaderPrice"]',
    '[data-zone-name="ProductSnippetGallery"]',
  ],
  finalPrice: [
    '[data-zone-name="price"] [data-auto="price"]',
    '[data-auto="snippet-price-current"]',
    '[data-auto-themes="price"]',
    '[data-auto="price"]',
  ],
  oldPrice: [
    '[data-auto="old-price"]',
    '[data-auto="snippet-price-old"]',
    '[data-baobab-name*="oldPrice"]',
  ],
  title: [
    '[data-additional-zone="title"] h1',
    'h1[data-baobab-name*="title" i]',
    'h1[data-zone-name="title"]',
    'h1',
  ],
  image: [
    '[data-zone-name="picture"] img',
    'img[data-zone-name="picture"]',
    'img[itemprop="image"]',
  ],
  rating: [
    '[data-baobab-name*="rating" i]',
    '[data-auto="reviewsCount"]',
    'span[itemprop="ratingValue"]',
  ],
  reviewCount: [
    '[data-baobab-name*="reviewsCount" i]',
    '[data-auto="reviewsCount"]',
    'a[href*="reviews"]',
  ],
  sellerName: [
    '[data-baobab-name="shopName"]',
    '[data-zone-name="shopName"]',
  ],
  description: [
    '[data-zone-name="productDescription"]',
    '[data-baobab-name*="description" i]',
    '#productDescription',
  ],
  characteristics: [
    '[data-zone-name="productSpecs"]',
    '[data-baobab-name*="specs" i]',
    'dl[data-zone-name="productSpecs"]',
  ],
} as const;
