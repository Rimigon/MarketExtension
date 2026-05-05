import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, detectMarketplace } from '@/shared/url';

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

describe('detectMarketplace', () => {
  it('detects all three marketplaces', () => {
    expect(detectMarketplace('https://www.ozon.ru/product/x/')).toBe('ozon');
    expect(detectMarketplace('https://wildberries.ru/catalog/123/detail.aspx')).toBe('wildberries');
    expect(detectMarketplace('https://market.yandex.ru/product--x/123')).toBe('yandex-market');
    expect(detectMarketplace('https://example.com')).toBeNull();
  });
});
