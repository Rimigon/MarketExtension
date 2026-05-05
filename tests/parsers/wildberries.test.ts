import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  extractWildberriesProduct,
  isWildberriesProductPage,
  extractSkuFromPath,
} from '@/parsers/wildberries/extract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'wildberries');

function loadDoc(name: string): Document {
  const html = readFileSync(path.join(fixturesDir, name), 'utf8');
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

describe('Wildberries: isProductPage', () => {
  it('matches /catalog/<id>/detail.aspx', () => {
    expect(
      isWildberriesProductPage(new URL('https://www.wildberries.ru/catalog/12345678/detail.aspx')),
    ).toBe(true);
    expect(
      isWildberriesProductPage(new URL('https://www.wildberries.ru/catalog/12345678/detail.aspx?targetUrl=BP')),
    ).toBe(true);
  });

  it('does not match category pages', () => {
    expect(isWildberriesProductPage(new URL('https://www.wildberries.ru/catalog/zhenshchinam'))).toBe(false);
  });

  it('extracts numeric SKU (nm) from product path', () => {
    expect(extractSkuFromPath('/catalog/12345678/detail.aspx')).toBe('12345678');
    expect(extractSkuFromPath('/catalog/zhenshchinam')).toBe(null);
  });
});

describe('Wildberries: extract with JSON-LD', () => {
  const url = new URL('https://www.wildberries.ru/catalog/12345678/detail.aspx?utm_source=email');

  it('returns a fully populated ParsedProduct with DOM-derived current price', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractWildberriesProduct(doc, url);
    expect(parsed).not.toBeNull();
    expect(parsed!.marketplace).toBe('wildberries');
    expect(parsed!.title).toBe('Кроссовки Nike Air Max');
    expect(parsed!.brand).toBe('Nike');
    expect(parsed!.sku).toBe('12345678');
    // DOM shows the actual sale price (4990) — JSON-LD's 5990 is the catalog/base price.
    expect(parsed!.currentPrice).toBe(4990);
    expect(parsed!.oldPrice).toBe(7990);
    expect(parsed!.discountPct).toBeGreaterThan(30);
    expect(parsed!.availability).toBe('in_stock');
    expect(parsed!.imageUrl).toContain('wbbasket.ru');
    expect(parsed!.rating).toBeCloseTo(4.6, 1);
    expect(parsed!.reviewCount).toBe(523);
    expect(parsed!.parserStatus).toBe('ok');
  });

  it('canonicalizes URL by stripping utm_source', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractWildberriesProduct(doc, url);
    expect(parsed!.canonicalUrl).not.toContain('utm_source');
  });

  it('extracts characteristics as ordered specs array', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractWildberriesProduct(doc, url);
    expect(parsed!.specs).toBeDefined();
    expect(parsed!.specs!.length).toBeGreaterThanOrEqual(3);
    const byName = Object.fromEntries(parsed!.specs!.map((s) => [s.name, s.value]));
    expect(byName['Размер']).toBe('42');
    expect(byName['Цвет']).toBe('Чёрный');
  });
});

describe('Wildberries: extract with DOM-only fallback', () => {
  const url = new URL('https://www.wildberries.ru/catalog/87654321/detail.aspx');

  it('still extracts title and price when JSON-LD is missing', () => {
    const doc = loadDoc('dom-only.html');
    const parsed = extractWildberriesProduct(doc, url);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toContain('Платье');
    expect(parsed!.currentPrice).toBe(2490);
    expect(parsed!.oldPrice).toBeNull();
    expect(parsed!.discountPct).toBeNull();
    expect(parsed!.sku).toBe('87654321');
    expect(parsed!.parserStatus).toBe('ok');
  });
});

describe('Wildberries: extract on non-product page', () => {
  it('returns null', () => {
    const doc = loadDoc('not-product.html');
    const parsed = extractWildberriesProduct(
      doc,
      new URL('https://www.wildberries.ru/catalog/zhenshchinam'),
    );
    expect(parsed).toBeNull();
  });
});
