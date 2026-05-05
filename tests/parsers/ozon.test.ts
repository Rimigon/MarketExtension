import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { extractOzonProduct, isOzonProductPage, extractSkuFromPath } from '@/parsers/ozon/extract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'ozon');

function loadDoc(name: string): Document {
  const html = readFileSync(path.join(fixturesDir, name), 'utf8');
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

describe('Ozon: isProductPage', () => {
  it('matches /product/<slug>-<id>/', () => {
    expect(
      isOzonProductPage(new URL('https://www.ozon.ru/product/chaynik-bosch-twk7203-123456789/')),
    ).toBe(true);
  });

  it('does not match category pages', () => {
    expect(isOzonProductPage(new URL('https://www.ozon.ru/category/elektronika-15500/'))).toBe(false);
  });

  it('extracts numeric SKU from product path', () => {
    expect(extractSkuFromPath('/product/chaynik-bosch-twk7203-123456789/')).toBe('123456789');
    expect(extractSkuFromPath('/category/elektronika-15500/')).toBe(null);
  });
});

describe('Ozon: extract with JSON-LD', () => {
  const url = new URL('https://www.ozon.ru/product/chaynik-bosch-twk7203-123456789/?utm_source=email');

  it('returns a fully populated ParsedProduct', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed).not.toBeNull();
    expect(parsed!.marketplace).toBe('ozon');
    expect(parsed!.title).toBe('Чайник электрический Bosch TWK7203');
    expect(parsed!.brand).toBe('Bosch');
    expect(parsed!.sku).toBe('123456789');
    expect(parsed!.currentPrice).toBe(3990);
    expect(parsed!.oldPrice).toBe(5490);
    expect(parsed!.discountPct).toBeGreaterThan(20);
    expect(parsed!.availability).toBe('in_stock');
    expect(parsed!.imageUrl).toContain('100.jpg');
    expect(parsed!.rating).toBeCloseTo(4.7, 1);
    expect(parsed!.parserStatus).toBe('ok');
  });

  it('produces a 2-tier price array when there is a discounted + struck price', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.priceTiers).toBeDefined();
    expect(parsed!.priceTiers!.length).toBe(2);
    expect(parsed!.priceTiers![0]).toEqual({ label: expect.any(String), amount: 3990, kind: 'discounted' });
    expect(parsed!.priceTiers![1]).toEqual({ label: 'Без скидки', amount: 5490, kind: 'original' });
  });

  it('canonicalizes URL by stripping utm_source', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.canonicalUrl).not.toContain('utm_source');
  });
});

describe('Ozon: extract with DOM-only fallback', () => {
  const url = new URL('https://www.ozon.ru/product/kofevarka-delonghi-ec685-987654321/');

  it('still extracts title and price when JSON-LD is missing', () => {
    const doc = loadDoc('dom-only.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toContain('DeLonghi');
    expect(parsed!.currentPrice).toBe(24990);
    expect(parsed!.oldPrice).toBeNull();
    expect(parsed!.discountPct).toBeNull();
    expect(parsed!.sku).toBe('987654321');
    expect(parsed!.parserStatus).toBe('ok');
  });
});

describe('Ozon: realistic page (hashed classes, "priceWithoutDiscount", seller in webStickyProducts)', () => {
  const url = new URL('https://www.ozon.ru/product/chehol-1630582255/');

  it('detects oldPrice via class containing "priceWithoutDiscount"', () => {
    const doc = loadDoc('realistic.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.currentPrice).toBe(1261);
    expect(parsed!.oldPrice).toBe(2100);
    expect(parsed!.discountPct).toBe(40);
  });

  it('extracts review count from /reviews/ link text', () => {
    const doc = loadDoc('realistic.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.reviewCount).toBe(767);
  });
});

describe('Ozon: real card 1630582255 (bank discount + non-detected strikethrough + chat-link merchant)', () => {
  const url = new URL('https://www.ozon.ru/product/kartridzh-colouring-1630582255/');

  it('takes the smallest visible price as currentPrice (bank-discounted)', () => {
    const doc = loadDoc('real-card-1630582255.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.currentPrice).toBe(1261);
  });

  it('takes the largest visible price as oldPrice (when strikethrough class isn\'t detected)', () => {
    const doc = loadDoc('real-card-1630582255.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.oldPrice).toBe(3291);
    expect(parsed!.discountPct).toBeGreaterThan(50);
  });

  it('emits 3 price tiers: «С банками», «С другими банками», «Без скидки»', () => {
    const doc = loadDoc('real-card-1630582255.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.priceTiers).toBeDefined();
    expect(parsed!.priceTiers!.length).toBe(3);
    const tiers = parsed!.priceTiers!;
    expect(tiers[0]).toEqual({ label: 'С банками', amount: 1261, kind: 'discounted' });
    expect(tiers[1]).toEqual({ label: 'С другими банками', amount: 1386, kind: 'regular' });
    expect(tiers[2]).toEqual({ label: 'Без скидки', amount: 3291, kind: 'original' });
  });

  it('still extracts rating and reviewCount', () => {
    const doc = loadDoc('real-card-1630582255.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.rating).toBeCloseTo(4.8, 1);
    expect(parsed!.reviewCount).toBe(767);
  });
});

describe('Ozon: extract on non-product page', () => {
  it('returns null', () => {
    const doc = loadDoc('not-product.html');
    const parsed = extractOzonProduct(doc, new URL('https://www.ozon.ru/category/elektronika-15500/'));
    expect(parsed).toBeNull();
  });
});

describe('Ozon: full extraction (description, specs, reviews, full title)', () => {
  const url = new URL('https://www.ozon.ru/product/chaynik-bosch-twk7203-123456789/');

  it('extracts description from JSON-LD or DOM, picking the longest', () => {
    const doc = loadDoc('full.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.description).toBeTruthy();
    expect(parsed!.description!.length).toBeGreaterThan(50);
    expect(parsed!.description).toContain('1.7 литра');
  });

  it('extracts characteristics as ordered specs array', () => {
    const doc = loadDoc('full.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.specs).toBeDefined();
    expect(parsed!.specs!.length).toBeGreaterThanOrEqual(4);
    const byName = Object.fromEntries(parsed!.specs!.map((s) => [s.name, s.value]));
    expect(byName['Объём']).toBe('1.7 л');
    expect(byName['Мощность']).toBe('2200 Вт');
    expect(byName['Цвет']).toBe('Белый');
  });

  it('extracts reviewCount from DOM (overrides shorter JSON-LD count if present)', () => {
    const doc = loadDoc('full.html');
    const parsed = extractOzonProduct(doc, url);
    // DOM says "2 348 отзывов", JSON-LD says 1234 — DOM wins.
    expect(parsed!.reviewCount).toBe(2348);
  });

  it('uses the longer DOM h1 over JSON-LD short name', () => {
    const doc = loadDoc('full.html');
    const parsed = extractOzonProduct(doc, url);
    // DOM h1 is "Чайник электрический Bosch TWK7203, 1.7 л, 2200 Вт, белый" (longer);
    // JSON-LD name is "Чайник Bosch TWK7203" (shorter).
    expect(parsed!.title).toContain('1.7 л');
    expect(parsed!.title.length).toBeGreaterThan(30);
  });

  it('keeps both prices: discounted (current) and original (old)', () => {
    const doc = loadDoc('full.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed!.currentPrice).toBe(3990);
    expect(parsed!.oldPrice).toBe(5490);
    expect(parsed!.discountPct).toBeGreaterThan(25);
  });
});

describe('Ozon: three-price block (Ozon Card / regular / strikethrough)', () => {
  const url = new URL('https://www.ozon.ru/product/smartfon-xiaomi-13t-555000111/');

  it('picks min non-struck as currentPrice and max struck as oldPrice', () => {
    const doc = loadDoc('three-prices.html');
    const parsed = extractOzonProduct(doc, url);
    expect(parsed).not.toBeNull();
    // 29 990 — Ozon Card discounted price (min non-struck), should be currentPrice
    expect(parsed!.currentPrice).toBe(29990);
    // 49 990 — strikethrough «old» price
    expect(parsed!.oldPrice).toBe(49990);
    // installment ("от 2 999 × 12") and cashback ("+1 200 баллов") must be ignored
    expect(parsed!.discountPct).toBe(40);
  });

  it('overrides JSON-LD price (which often shows non-discounted)', () => {
    const doc = loadDoc('three-prices.html');
    const parsed = extractOzonProduct(doc, url);
    // JSON-LD has price=39990, but DOM has 29990 (Ozon Card) — DOM should win
    expect(parsed!.currentPrice).not.toBe(39990);
    expect(parsed!.currentPrice).toBe(29990);
  });
});
