import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, canonicalProductUrl, detectMarketplace } from '@/shared/url';

describe('canonicalizeUrl', () => {
  it('strips utm and ozon-specific tracking params', () => {
    const out = canonicalizeUrl('https://www.ozon.ru/product/x-1/?utm_source=email&sortIdx=2&keep=1');
    expect(out).toBe('https://ozon.ru/product/x-1/?keep=1');
  });

  it('lowercases www and is idempotent', () => {
    const a = canonicalizeUrl('https://www.ozon.ru/product/x-1/');
    const b = canonicalizeUrl(a);
    expect(a).toBe('https://ozon.ru/product/x-1/');
    expect(a).toBe(b);
  });
});

describe('canonicalProductUrl', () => {
  it('normalizes Ozon product URL (strips slug and query)', () => {
    expect(canonicalProductUrl('ozon', 'https://www.ozon.ru/product/iphone-15-12345/')).toBe('https://ozon.ru/product/-12345/');
    expect(canonicalProductUrl('ozon', 'https://ozon.ru/product/super-deal-12345/?utm_source=email&tab=reviews')).toBe(
      'https://ozon.ru/product/-12345/',
    );
  });

  it('normalizes Wildberries product URL (strips query)', () => {
    expect(canonicalProductUrl('wildberries', 'https://www.wildberries.ru/catalog/12345/detail.aspx')).toBe(
      'https://wildberries.ru/catalog/12345/detail.aspx',
    );
    expect(
      canonicalProductUrl('wildberries', 'https://wildberries.ru/catalog/12345/detail.aspx?targetUrl=MI&sort=popular'),
    ).toBe('https://wildberries.ru/catalog/12345/detail.aspx');
  });

  it('normalizes Yandex Market product URL (strips slug and query)', () => {
    expect(canonicalProductUrl('yandex-market', 'https://market.yandex.ru/product--iphone-15/1234567')).toBe(
      'https://market.yandex.ru/product/1234567',
    );
    expect(canonicalProductUrl('yandex-market', 'https://market.yandex.ru/product/iphone-15/1234567?sku=999&clid=1')).toBe(
      'https://market.yandex.ru/product/1234567',
    );
    expect(canonicalProductUrl('yandex-market', 'https://market.yandex.ru/card/iphone-15/1234567')).toBe(
      'https://market.yandex.ru/product/1234567',
    );
  });

  it('falls back to canonicalizeUrl for non-product paths', () => {
    expect(canonicalProductUrl('ozon', 'https://ozon.ru/category/shoes/?categoryId=5')).toBe(
      'https://ozon.ru/category/shoes/?categoryId=5',
    );
  });
});

describe('detectMarketplace', () => {
  it('detects all three marketplaces', () => {
    expect(detectMarketplace('https://www.ozon.ru/product/x/')).toBe('ozon');
    expect(detectMarketplace('https://wildberries.ru/catalog/123/detail.aspx')).toBe('wildberries');
    expect(detectMarketplace('https://market.yandex.ru/product--x/123')).toBe('yandex-market');
    expect(detectMarketplace('https://example.com')).toBeNull();
  });
});
