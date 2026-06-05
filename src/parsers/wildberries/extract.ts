import type { Availability, ParsedProduct, ParserStatus, ProductSpec } from '@/shared/types';
import { canonicalProductUrl } from '@/shared/url';
import { findJsonLdProduct, parsePriceText, readJsonLd } from '../base';
import { WB_SELECTORS } from './selectors';

const PARSER_VERSION = 1;
const MAX_DESCRIPTION_CHARS = 5000;
const MAX_SPECS = 100;

const PRODUCT_PATH_RE = /^\/catalog\/(\d+)\/detail\.aspx/i;

export function isWildberriesProductPage(url: URL): boolean {
  return PRODUCT_PATH_RE.test(url.pathname);
}

export function extractSkuFromPath(pathname: string): string | null {
  const m = PRODUCT_PATH_RE.exec(pathname);
  return m ? m[1]! : null;
}

function firstMatch<T extends Element>(doc: ParentNode, selectors: readonly string[]): T | null {
  for (const sel of selectors) {
    const found = doc.querySelector<T>(sel);
    if (found) return found;
  }
  return null;
}

function pickLongest(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

function extractReviewCountFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /(\d[\d\s]*)/.exec(text.replace(/ /g, ' '));
  if (!m) return null;
  const n = parseInt(m[1]!.replace(/\s+/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function extractDescription(block: HTMLElement): string | undefined {
  const text = block.textContent?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_DESCRIPTION_CHARS ? text.slice(0, MAX_DESCRIPTION_CHARS) : text;
}

function extractSpecs(block: HTMLElement): ProductSpec[] {
  const specs: ProductSpec[] = [];
  const seen = new Set<string>();

  const push = (name: string, value: string) => {
    const n = name.trim().replace(/\s+/g, ' ');
    const v = value.trim().replace(/\s+/g, ' ');
    if (!n || !v || n.length > 200 || v.length > 1000) return;
    if (seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    specs.push({ name: n, value: v });
  };

  // <table><tr><th>Name</th><td>Value</td></tr></table> — main WB layout
  const rows = block.querySelectorAll<HTMLElement>('tr');
  for (const tr of rows) {
    const cells = tr.children;
    if (cells.length < 2) continue;
    push(cells[0]!.textContent ?? '', cells[1]!.textContent ?? '');
    if (specs.length >= MAX_SPECS) break;
  }

  // <dl><dt>Name</dt><dd>Value</dd></dl>
  if (specs.length < MAX_SPECS) {
    const dts = block.querySelectorAll<HTMLElement>('dl dt');
    for (const dt of dts) {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === 'DD') {
        push(dt.textContent ?? '', dd.textContent ?? '');
        if (specs.length >= MAX_SPECS) break;
      }
    }
  }

  return specs;
}

interface JsonLdProduct {
  name?: string;
  description?: string;
  brand?: { name?: string } | string;
  image?: string | string[];
  sku?: string | number;
  aggregateRating?: { ratingValue?: string | number; reviewCount?: string | number };
  offers?:
    | {
        price?: string | number;
        priceCurrency?: string;
        availability?: string;
      }
    | Array<{ price?: string | number }>;
}

function fromJsonLd(doc: Document): Partial<ParsedProduct> | null {
  const blocks = readJsonLd(doc);
  const product = findJsonLdProduct(blocks) as JsonLdProduct | null;
  if (!product) return null;

  const result: Partial<ParsedProduct> = {};
  if (typeof product.name === 'string') result.title = product.name;

  if (typeof product.description === 'string') {
    const d = product.description.replace(/\s+/g, ' ').trim();
    if (d) result.description = d.length > MAX_DESCRIPTION_CHARS ? d.slice(0, MAX_DESCRIPTION_CHARS) : d;
  }

  if (typeof product.brand === 'string') result.brand = product.brand;
  else if (product.brand && typeof product.brand === 'object' && product.brand.name) {
    result.brand = product.brand.name;
  }

  if (typeof product.image === 'string') result.imageUrl = product.image;
  else if (Array.isArray(product.image) && product.image.length > 0) result.imageUrl = product.image[0];

  if (product.sku != null) result.sku = String(product.sku);

  const offers = product.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (offer && typeof offer === 'object') {
    if ('price' in offer && offer.price != null) {
      const num = typeof offer.price === 'number' ? offer.price : parsePriceText(String(offer.price));
      if (num != null) result.currentPrice = num;
    }
    if ('availability' in offer && typeof offer.availability === 'string') {
      result.availability = offer.availability.toLowerCase().includes('instock') ? 'in_stock' : 'out_of_stock';
    }
  }

  if (product.aggregateRating) {
    const r = product.aggregateRating.ratingValue;
    if (r != null) {
      const num = typeof r === 'number' ? r : parseFloat(String(r));
      if (Number.isFinite(num)) result.rating = num;
    }
    const c = product.aggregateRating.reviewCount;
    if (c != null) {
      const num = typeof c === 'number' ? c : parseInt(String(c), 10);
      if (Number.isFinite(num)) result.reviewCount = num;
    }
  }

  return result;
}

function fromDom(doc: Document): Partial<ParsedProduct> {
  const result: Partial<ParsedProduct> = {};

  const titleEl = firstMatch<HTMLElement>(doc, WB_SELECTORS.title);
  if (titleEl) {
    const text = titleEl.textContent?.trim();
    if (text) result.title = text;
  }

  const brandEl = firstMatch<HTMLElement>(doc, WB_SELECTORS.brand);
  if (brandEl) {
    const text = brandEl.textContent?.trim();
    if (text) result.brand = text;
  }

  const finalEl = firstMatch<HTMLElement>(doc, WB_SELECTORS.finalPrice);
  if (finalEl) {
    const num = parsePriceText(finalEl.textContent);
    if (num != null && num > 0) result.currentPrice = num;
  }

  const oldEl = firstMatch<HTMLElement>(doc, WB_SELECTORS.oldPrice);
  if (oldEl) {
    const num = parsePriceText(oldEl.textContent);
    if (num != null && num > 0 && result.currentPrice != null && num > result.currentPrice) {
      result.oldPrice = num;
    } else if (num != null && num > 0 && result.currentPrice == null) {
      // No final-price element found, but old-price exists — use it as current.
      result.currentPrice = num;
    }
  }

  const imageEl = firstMatch<HTMLImageElement>(doc, WB_SELECTORS.image);
  if (imageEl?.src) result.imageUrl = imageEl.src;

  const ratingEl = firstMatch<HTMLElement>(doc, WB_SELECTORS.rating);
  if (ratingEl) {
    const num = parsePriceText(ratingEl.textContent);
    if (num != null && num > 0 && num <= 5) result.rating = num;
  }

  const reviewEl = firstMatch<HTMLElement>(doc, WB_SELECTORS.reviewCount);
  if (reviewEl) {
    const n = extractReviewCountFromText(reviewEl.textContent);
    if (n != null) result.reviewCount = n;
  }

  const descEl = firstMatch<HTMLElement>(doc, WB_SELECTORS.description);
  if (descEl) {
    const d = extractDescription(descEl);
    if (d) result.description = d;
  }

  const charBlock = firstMatch<HTMLElement>(doc, WB_SELECTORS.characteristics);
  if (charBlock) {
    const specs = extractSpecs(charBlock);
    if (specs.length > 0) result.specs = specs;
  }

  return result;
}

export function extractWildberriesProduct(doc: Document, url: URL): ParsedProduct | null {
  if (!isWildberriesProductPage(url)) return null;

  const fromLd = fromJsonLd(doc) ?? {};
  const fromHtml = fromDom(doc);

  // DOM trumps JSON-LD on prices (DOM = what user actually sees, including current promo).
  // JSON-LD wins for static metadata when DOM is missing it.
  const title = pickLongest(fromHtml.title, fromLd.title);
  const merged: Partial<ParsedProduct> = {
    title,
    brand: fromHtml.brand ?? fromLd.brand,
    imageUrl: fromHtml.imageUrl || fromLd.imageUrl,
    sku: fromLd.sku ?? extractSkuFromPath(url.pathname),
    currentPrice: fromHtml.currentPrice ?? fromLd.currentPrice ?? null,
    oldPrice: fromHtml.oldPrice ?? null,
    availability: fromHtml.availability ?? fromLd.availability,
    rating: fromHtml.rating ?? fromLd.rating,
    reviewCount: fromHtml.reviewCount ?? fromLd.reviewCount,
    description: pickLongest(fromHtml.description, fromLd.description),
    specs: fromHtml.specs && fromHtml.specs.length > 0 ? fromHtml.specs : undefined,
  };

  const currentPrice = merged.currentPrice ?? null;
  const oldPrice = merged.oldPrice ?? null;
  const discountPct =
    currentPrice != null && oldPrice != null && oldPrice > currentPrice
      ? Math.round(((oldPrice - currentPrice) / oldPrice) * 100)
      : null;

  const availability: Availability = merged.availability ?? (currentPrice != null ? 'in_stock' : 'unknown');

  const missing: string[] = [];
  if (!merged.title) missing.push('title');
  if (currentPrice == null) missing.push('currentPrice');
  const status: ParserStatus =
    missing.length === 0 ? 'ok' : missing.includes('title') && currentPrice == null ? 'failed' : 'partial';

  if (status === 'failed') return null;

  return {
    marketplace: 'wildberries',
    url: url.toString(),
    canonicalUrl: canonicalProductUrl('wildberries', url.toString()),
    sku: merged.sku ?? null,
    title: merged.title!,
    brand: merged.brand,
    imageUrl: merged.imageUrl,
    currentPrice,
    oldPrice,
    discountPct,
    availability,
    rating: merged.rating,
    reviewCount: merged.reviewCount,
    description: merged.description,
    specs: merged.specs,
    parserVersion: PARSER_VERSION,
    parserStatus: status,
    missingFields: missing.length > 0 ? missing : undefined,
  };
}
