import type {
  Availability,
  ParsedProduct,
  ParserStatus,
  PriceTier,
  ProductSpec,
} from '@/shared/types';
import { canonicalizeUrl } from '@/shared/url';
import { findJsonLdProduct, parsePriceText, readJsonLd } from '../base';
import { YM_SELECTORS } from './selectors';

const PARSER_VERSION = 2;
const MAX_DESCRIPTION_CHARS = 5000;
const MAX_SPECS = 100;

// Matches all known Yandex Market product URL shapes:
//   /product/<id>
//   /product--<slug>/<id>
//   /card/<slug>/<id>          (new format, ~2025+)
const PRODUCT_PATH_RE = /^\/(?:card\/[^/]+|product(?:--[^/]+)?)\/(\d+)/i;

export function isYandexMarketProductPage(url: URL): boolean {
  return PRODUCT_PATH_RE.test(url.pathname);
}

export function extractSkuFromPath(pathname: string): string | null {
  const m = PRODUCT_PATH_RE.exec(pathname);
  return m ? m[1]! : null;
}

export function isYandexCaptchaPage(doc: Document): boolean {
  if (doc.querySelector('#captcha-form, form[action*="captcha"]')) return true;
  const txt = (doc.body?.textContent ?? '').slice(0, 2000);
  return /Подтвердите,\s+что\s+запросы.*автоматическ/i.test(txt);
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

/**
 * Yandex's `[data-zone-name="productDescription"]` block frequently nests:
 *   - the actual description paragraph(s) we want,
 *   - the «Общие характеристики» specs list,
 *   - certificate/document widgets injected by the Apiary front-end framework
 *     (their initialization payload leaks into textContent as raw JSON-ish noise),
 *   - footer disclaimers, related-links and «Показать полностью / Все характеристики».
 * We clone the block, remove obvious noise, then trim known suffix boundaries.
 */
function extractDescription(block: HTMLElement): string | undefined {
  const clone = block.cloneNode(true) as HTMLElement;

  // Strip elements whose textContent is structurally not part of the description.
  const noiseSelectors = [
    'script',
    'style',
    'noscript',
    'template',
    'button',
    'dl',
    'table',
    'tr',
    '[data-zone-name="productSpecs"]',
    '[data-baobab-name*="specs" i]',
    '[data-baobab-name*="Documents" i]',
    '[data-baobab-name*="certificate" i]',
    '[data-baobab-name*="aboutRecom" i]',
    '[data-baobab-name*="related" i]',
    '[data-apiary-widget-name]',
    '[data-apiary-widget-id]',
    '[data-apiary-marker-portal]',
    'apiary-portal-marker',
  ];
  for (const sel of noiseSelectors) {
    for (const el of Array.from(clone.querySelectorAll(sel))) {
      el.parentElement?.removeChild(el);
    }
  }

  let text = clone.textContent?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;

  // Cut at known section boundaries that may still slip through (e.g. when the
  // specs block isn't matched by a selector but Yandex prints the heading inline).
  const cutMarkers = [
    'Общие характеристики',
    'Все характеристики',
    'Сертификаты',
    'Сертификат соответствия',
    'Перед покупкой уточняйте',
    'Внешний вид товаров',
    'window.apiary',
    'apiarySleepingQueue',
    'apiaryMarkerPortal',
  ];
  for (const marker of cutMarkers) {
    const idx = text.indexOf(marker);
    if (idx > 0) text = text.slice(0, idx).trim();
  }

  // Collapse the «Показать полностью / Скрыть» toggles and stray apiary JSON tails.
  text = text
    .replace(/Показать\s+(полностью|больше|весь)\s*\.?\s*$/i, '')
    .replace(/Скрыть\s*$/i, '')
    .replace(/^О\s+товаре[\s.:]*/i, '')
    .trim();

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

  // <dl><dt>Name</dt><dd>Value</dd>
  const dts = block.querySelectorAll<HTMLElement>('dl dt');
  for (const dt of dts) {
    const dd = dt.nextElementSibling;
    if (dd && dd.tagName === 'DD') {
      push(dt.textContent ?? '', dd.textContent ?? '');
      if (specs.length >= MAX_SPECS) break;
    }
  }

  if (specs.length < MAX_SPECS) {
    const rows = block.querySelectorAll<HTMLElement>('tr');
    for (const tr of rows) {
      const cells = tr.children;
      if (cells.length < 2) continue;
      push(cells[0]!.textContent ?? '', cells[1]!.textContent ?? '');
      if (specs.length >= MAX_SPECS) break;
    }
  }

  return specs;
}

interface JsonLdOffer {
  price?: string | number;
  priceCurrency?: string;
  availability?: string;
  seller?: { name?: string } | string;
}

interface JsonLdAggregateOffer {
  '@type'?: string;
  lowPrice?: string | number;
  highPrice?: string | number;
  offerCount?: string | number;
  availability?: string;
}

interface JsonLdProduct {
  name?: string;
  description?: string;
  brand?: { name?: string } | string;
  image?: string | string[];
  sku?: string | number;
  aggregateRating?: { ratingValue?: string | number; reviewCount?: string | number };
  offers?: JsonLdOffer | JsonLdAggregateOffer | Array<JsonLdOffer | JsonLdAggregateOffer>;
}

function asNumber(v: string | number | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parsePriceText(String(v));
  return n;
}

interface OfferSummary {
  price: number | null;
  oldPrice: number | null;
  availability?: Availability;
  sellerName?: string;
}

function summarizeOffers(offers: JsonLdProduct['offers']): OfferSummary {
  if (!offers) return { price: null, oldPrice: null };

  const list: Array<JsonLdOffer | JsonLdAggregateOffer> = Array.isArray(offers) ? offers : [offers];

  let bestPrice: number | null = null;
  let bestSeller: string | undefined;
  let bestAvailability: Availability | undefined;
  let highPrice: number | null = null;

  for (const o of list) {
    if (!o || typeof o !== 'object') continue;

    const isAggregate = '@type' in o && typeof o['@type'] === 'string' && /AggregateOffer/i.test(o['@type']);

    if (isAggregate) {
      const agg = o as JsonLdAggregateOffer;
      const low = asNumber(agg.lowPrice);
      const high = asNumber(agg.highPrice);
      if (low != null && (bestPrice == null || low < bestPrice)) bestPrice = low;
      if (high != null && (highPrice == null || high > highPrice)) highPrice = high;
      if (typeof agg.availability === 'string' && agg.availability.toLowerCase().includes('instock')) {
        bestAvailability = 'in_stock';
      }
    } else {
      const off = o as JsonLdOffer;
      const p = asNumber(off.price);
      if (p != null && (bestPrice == null || p < bestPrice)) {
        bestPrice = p;
        if (typeof off.seller === 'string') bestSeller = off.seller;
        else if (off.seller && typeof off.seller === 'object' && off.seller.name) bestSeller = off.seller.name;
      }
      if (typeof off.availability === 'string' && off.availability.toLowerCase().includes('instock')) {
        bestAvailability = 'in_stock';
      }
    }
  }

  const oldPrice = highPrice != null && bestPrice != null && highPrice > bestPrice ? highPrice : null;
  return { price: bestPrice, oldPrice, availability: bestAvailability, sellerName: bestSeller };
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

  const summary = summarizeOffers(product.offers);
  if (summary.price != null) result.currentPrice = summary.price;
  if (summary.oldPrice != null) result.oldPrice = summary.oldPrice;
  if (summary.availability) result.availability = summary.availability;

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

const PURE_PRICE_RE = /^\s*\d[\d\s ]*[.,]?\d*\s*₽\s*$/;

/**
 * Walk a price block and pull every distinct ruble value with a nearby «Плюс / Без Плюса /
 * Без скидки» hint so we can label tiers. Returns ascending by amount.
 */
function extractYmPriceTiers(block: HTMLElement): PriceTier[] {
  const seen = new Map<number, { kind: PriceTier['kind']; label: string }>();
  const blockText = (block.textContent ?? '').replace(/\s+/g, ' ');
  const hasPlus = /с\s+Плюс/i.test(blockText);
  const hasNoPlus = /без\s+Плюс/i.test(blockText);

  const elements = block.querySelectorAll<HTMLElement>('span, div, b, strong, s, del');
  for (const el of elements) {
    // Use direct text only — avoids double-counting parent + nested span.
    let direct = '';
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3 /* Node.TEXT_NODE */) direct += child.textContent ?? '';
    }
    direct = direct.replace(/\s+/g, ' ').trim();
    if (!direct || !PURE_PRICE_RE.test(direct)) continue;
    const price = parsePriceText(direct);
    if (price == null || price < 1 || price > 100_000_000) continue;
    if (seen.has(price)) continue;

    // Look at the surrounding ~80 chars of context for a label.
    const ctx = (el.parentElement?.textContent ?? '').replace(/\s+/g, ' ');
    const idx = ctx.indexOf(direct);
    const around = idx >= 0 ? ctx.slice(Math.max(0, idx - 60), idx + direct.length + 60) : ctx;

    let kind: PriceTier['kind'] = 'regular';
    let label = 'Цена';
    if (/с\s+Плюс/i.test(around)) {
      kind = 'discounted';
      label = 'С Яндекс Плюсом';
    } else if (/без\s+Плюс/i.test(around)) {
      kind = 'regular';
      label = 'Без Плюса';
    } else if (
      /\bстарая\s+цена|без\s+скидки|обычная\s+цена/i.test(around) ||
      el.tagName === 'S' ||
      el.tagName === 'DEL' ||
      hasStrikethrough(el)
    ) {
      kind = 'original';
      label = 'Без скидки';
    } else if (hasPlus && !hasNoPlus) {
      kind = 'discounted';
      label = 'С Яндекс Плюсом';
    }
    seen.set(price, { kind, label });
  }

  if (seen.size === 0) return [];

  const sorted = Array.from(seen.entries()).sort((a, b) => a[0] - b[0]);
  // If multiple prices and no explicit Plus label was matched, assume the lowest is the Plus tier
  // (Yandex shows the Plus price as the bold headline by default).
  if (sorted.length >= 2 && !Array.from(seen.values()).some((v) => v.kind === 'discounted')) {
    sorted[0]![1] = { kind: 'discounted', label: 'С Яндекс Плюсом' };
    if (sorted.length === 2) {
      sorted[1]![1] = { kind: 'original', label: 'Без скидки' };
    }
  }
  return sorted.map(([amount, meta]) => ({ amount, kind: meta.kind, label: meta.label }));
}

function hasStrikethrough(el: HTMLElement): boolean {
  if (!el || !el.style) return false;
  const inline = el.style.textDecoration?.toLowerCase() ?? '';
  if (inline.includes('line-through')) return true;
  const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
  return /line-through|strike|old-?price/.test(cls);
}

function fromDom(doc: Document): Partial<ParsedProduct> {
  const result: Partial<ParsedProduct> = {};

  const titleEl = firstMatch<HTMLElement>(doc, YM_SELECTORS.title);
  if (titleEl) {
    const text = titleEl.textContent?.trim();
    if (text) result.title = text;
  }

  // Pull all distinct prices from the price block — gives us Plus-tier visibility.
  const priceBlock = firstMatch<HTMLElement>(doc, YM_SELECTORS.priceAnchor);
  if (priceBlock) {
    const tiers = extractYmPriceTiers(priceBlock);
    if (tiers.length > 0) {
      result.priceTiers = tiers;
      // Headline price = the «discounted» tier if present, otherwise the lowest visible price.
      const discounted = tiers.find((t) => t.kind === 'discounted') ?? tiers[0]!;
      result.currentPrice = discounted.amount;
      const original = tiers.find((t) => t.kind === 'original');
      if (original && original.amount > discounted.amount) result.oldPrice = original.amount;
    }
  }

  if (result.currentPrice == null) {
    const finalEl = firstMatch<HTMLElement>(doc, YM_SELECTORS.finalPrice);
    if (finalEl) {
      const num = parsePriceText(finalEl.textContent);
      if (num != null && num > 0) result.currentPrice = num;
    }
  }

  if (result.oldPrice == null) {
    const oldEl = firstMatch<HTMLElement>(doc, YM_SELECTORS.oldPrice);
    if (oldEl) {
      const num = parsePriceText(oldEl.textContent);
      if (num != null && num > 0 && result.currentPrice != null && num > result.currentPrice) {
        result.oldPrice = num;
      }
    }
  }

  const imageEl = firstMatch<HTMLImageElement>(doc, YM_SELECTORS.image);
  if (imageEl?.src) result.imageUrl = imageEl.src;

  const ratingEl = firstMatch<HTMLElement>(doc, YM_SELECTORS.rating);
  if (ratingEl) {
    const num = parsePriceText(ratingEl.textContent);
    if (num != null && num > 0 && num <= 5) result.rating = num;
  }

  const reviewEl = firstMatch<HTMLElement>(doc, YM_SELECTORS.reviewCount);
  if (reviewEl) {
    const n = extractReviewCountFromText(reviewEl.textContent);
    if (n != null) result.reviewCount = n;
  }

  const descEl = firstMatch<HTMLElement>(doc, YM_SELECTORS.description);
  if (descEl) {
    const d = extractDescription(descEl);
    if (d) result.description = d;
  }

  const charBlock = firstMatch<HTMLElement>(doc, YM_SELECTORS.characteristics);
  if (charBlock) {
    const specs = extractSpecs(charBlock);
    if (specs.length > 0) result.specs = specs;
  }

  return result;
}

export function extractYandexMarketProduct(doc: Document, url: URL): ParsedProduct | null {
  if (!isYandexMarketProductPage(url)) return null;
  // Captcha → bail; never poison price history with junk reads.
  if (isYandexCaptchaPage(doc)) return null;

  const fromLd = fromJsonLd(doc) ?? {};
  const fromHtml = fromDom(doc);

  const title = pickLongest(fromHtml.title, fromLd.title);
  // DOM shows what user actually sees (the "best" offer Yandex picked); JSON-LD lowPrice usually agrees.
  // If they disagree, DOM wins for current price.
  const merged: Partial<ParsedProduct> = {
    title,
    brand: fromLd.brand,
    imageUrl: fromHtml.imageUrl || fromLd.imageUrl,
    sku: fromLd.sku ?? extractSkuFromPath(url.pathname),
    currentPrice: fromHtml.currentPrice ?? fromLd.currentPrice ?? null,
    oldPrice: fromHtml.oldPrice ?? fromLd.oldPrice ?? null,
    availability: fromHtml.availability ?? fromLd.availability,
    rating: fromLd.rating ?? fromHtml.rating,
    reviewCount: fromHtml.reviewCount ?? fromLd.reviewCount,
    // JSON-LD's description is curated text from the seller catalogue and almost always cleaner
    // than the DOM scrape. Use the DOM version only as a fallback when JSON-LD is empty.
    description: fromLd.description ?? fromHtml.description,
    specs: fromHtml.specs && fromHtml.specs.length > 0 ? fromHtml.specs : undefined,
    priceTiers: fromHtml.priceTiers && fromHtml.priceTiers.length > 0 ? fromHtml.priceTiers : undefined,
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
    marketplace: 'yandex-market',
    url: url.toString(),
    canonicalUrl: canonicalizeUrl(url.toString()),
    sku: merged.sku ?? null,
    title: merged.title!,
    brand: merged.brand,
    imageUrl: merged.imageUrl,
    currentPrice,
    oldPrice,
    discountPct,
    availability,
    priceTiers: merged.priceTiers,
    rating: merged.rating,
    reviewCount: merged.reviewCount,
    description: merged.description,
    specs: merged.specs,
    parserVersion: PARSER_VERSION,
    parserStatus: status,
  };
}
