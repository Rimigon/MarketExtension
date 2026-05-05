import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  extractYandexMarketProduct,
  isYandexMarketProductPage,
  isYandexCaptchaPage,
  extractSkuFromPath,
} from '@/parsers/yandex-market/extract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'yandex-market');

function loadDoc(name: string): Document {
  const html = readFileSync(path.join(fixturesDir, name), 'utf8');
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

describe('Yandex Market: isProductPage', () => {
  it('matches /product--<slug>/<id>', () => {
    expect(
      isYandexMarketProductPage(new URL('https://market.yandex.ru/product--naushniki-sony/1234567890')),
    ).toBe(true);
  });

  it('matches the bare /product/<id> form', () => {
    expect(
      isYandexMarketProductPage(new URL('https://market.yandex.ru/product/1234567890')),
    ).toBe(true);
  });

  it('matches the new /card/<slug>/<id> form', () => {
    expect(
      isYandexMarketProductPage(
        new URL('https://market.yandex.ru/card/butylka-sleeve-ace/102810982863?nid=76662280'),
      ),
    ).toBe(true);
  });

  it('does not match category pages', () => {
    expect(isYandexMarketProductPage(new URL('https://market.yandex.ru/catalog--naushniki/12345'))).toBe(false);
  });

  it('extracts numeric SKU from product path', () => {
    expect(extractSkuFromPath('/product--naushniki/1234567890')).toBe('1234567890');
    expect(extractSkuFromPath('/product/9876543210')).toBe('9876543210');
    expect(extractSkuFromPath('/card/butylka-sleeve-ace/102810982863')).toBe('102810982863');
    expect(extractSkuFromPath('/catalog--foo')).toBe(null);
  });
});

describe('Yandex Market: extract with array of offers', () => {
  const url = new URL('https://market.yandex.ru/product--naushniki-sony/1234567890?clid=foo&utm_medium=cpc');

  it('picks the lowest offer price as currentPrice', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractYandexMarketProduct(doc, url);
    expect(parsed).not.toBeNull();
    expect(parsed!.currentPrice).toBe(29990);
  });

  it('uses DOM old-price as oldPrice', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractYandexMarketProduct(doc, url);
    expect(parsed!.oldPrice).toBe(39990);
    expect(parsed!.discountPct).toBeGreaterThan(20);
  });

  it('returns a fully populated ParsedProduct', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractYandexMarketProduct(doc, url);
    expect(parsed!.marketplace).toBe('yandex-market');
    expect(parsed!.brand).toBe('Sony');
    expect(parsed!.sku).toBe('1234567890');
    expect(parsed!.availability).toBe('in_stock');
    expect(parsed!.imageUrl).toContain('mds.yandex.net');
    expect(parsed!.rating).toBeCloseTo(4.8, 1);
    expect(parsed!.reviewCount).toBe(1245);
    expect(parsed!.parserStatus).toBe('ok');
  });

  it('uses the longer DOM h1 over JSON-LD short name', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractYandexMarketProduct(doc, url);
    expect(parsed!.title).toContain('полноразмерные');
  });

  it('canonicalizes URL by stripping utm_medium', () => {
    const doc = loadDoc('with-jsonld.html');
    const parsed = extractYandexMarketProduct(doc, url);
    expect(parsed!.canonicalUrl).not.toContain('utm_medium');
  });
});

describe('Yandex Market: AggregateOffer', () => {
  const url = new URL('https://market.yandex.ru/product--kofemashina-philips/9876543210');

  it('uses lowPrice as currentPrice and highPrice as oldPrice', () => {
    const doc = loadDoc('aggregate-offers.html');
    const parsed = extractYandexMarketProduct(doc, url);
    expect(parsed).not.toBeNull();
    expect(parsed!.currentPrice).toBe(44990);
    expect(parsed!.oldPrice).toBe(59990);
    expect(parsed!.parserStatus).toBe('ok');
  });
});

describe('Yandex Market: captcha', () => {
  it('detects a captcha page', () => {
    const doc = loadDoc('captcha.html');
    expect(isYandexCaptchaPage(doc)).toBe(true);
  });

  it('returns null when extracting from a captcha page', () => {
    const doc = loadDoc('captcha.html');
    const parsed = extractYandexMarketProduct(
      doc,
      new URL('https://market.yandex.ru/product--naushniki/1234567890'),
    );
    expect(parsed).toBeNull();
  });
});

describe('Yandex Market: extract on non-product page', () => {
  it('returns null', () => {
    const doc = loadDoc('not-product.html');
    const parsed = extractYandexMarketProduct(
      doc,
      new URL('https://market.yandex.ru/catalog--naushniki/12345'),
    );
    expect(parsed).toBeNull();
  });
});
