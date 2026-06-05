import type { Availability, ParsedProduct, ParserStatus, PriceTier, ProductSpec } from '@/shared/types';
import { canonicalProductUrl } from '@/shared/url';
import { findJsonLdProduct, parsePriceText, readJsonLd } from '../base';
import { OZON_SELECTORS } from './selectors';

const PARSER_VERSION = 4;
const MAX_DESCRIPTION_CHARS = 5000;
const MAX_SPECS = 100;

/** Ozon product URLs look like /product/<slug>-<numeric-id>/ */
const PRODUCT_PATH_RE = /^\/product\/[^/]*-(\d+)\/?$/i;

/** Tokens we don't want to treat as a price (installments, delivery, ratings, etc.). */
const PRICE_NOISE_RE = /×|x\s*\d|\bв\s+месяц\b|\bдоставк|%|\bбонус|\bкэшбэк|\bбаллов/i;

const PURE_PRICE_RE = /^[\d\s.,  ]+\s*(?:₽|руб|RUB)\.?\s*$/i;

export function extractSkuFromPath(pathname: string): string | null {
  const m = PRODUCT_PATH_RE.exec(pathname.replace(/\/+$/, '/'));
  return m ? m[1]! : null;
}

export function isOzonProductPage(url: URL): boolean {
  return PRODUCT_PATH_RE.test(url.pathname.replace(/\/+$/, '/'));
}

/**
 * Ozon CDN URLs encode the rendered width as `/c<NN>/` (e.g. `c100`, `c200`,
 * `wc500`). Gallery thumbnails are typically requested at small sizes, which
 * looks blurry in our dashboard. Rewrite to `c1000` — Ozon supports this size
 * for all multimedia paths, and the file is the same image, just a larger
 * pre-rendered variant. Non-Ozon URLs are returned unchanged.
 */
export function upgradeOzonImageUrl(url: string): string {
  if (!url) return url;
  if (!/ozone\.ru|ozonru\./i.test(url)) return url;
  return url.replace(/\/(wc|cs|c)\d+\//i, (_, prefix: string) => `/${prefix}1000/`);
}

function firstMatch<T extends Element>(doc: ParentNode, selectors: readonly string[]): T | null {
  for (const sel of selectors) {
    const found = doc.querySelector<T>(sel);
    if (found) return found;
  }
  return null;
}

function directText(el: Element): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

function elementClassString(el: Element): string {
  const c = (el as HTMLElement).className;
  if (typeof c === 'string') return c;
  // SVGAnimatedString or similar — fall back to attribute
  return el.getAttribute('class') ?? '';
}

function hasStrikethrough(el: Element): boolean {
  // 1. Tag-based — <s>, <del>, <strike>
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 8; depth++, cur = cur.parentElement) {
    const tag = cur.tagName;
    if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') return true;
  }

  // 2. Class-name regex (broad — Ozon uses minified hashes plus utility names)
  cur = el;
  for (let depth = 0; cur && depth < 8; depth++, cur = cur.parentElement) {
    const cls = elementClassString(cur);
    if (/strike|through|crossed|old[-_]?price|originalPrice|priceWithoutDiscount/i.test(cls)) return true;
  }

  // 3. Inline style
  cur = el;
  for (let depth = 0; cur && depth < 8; depth++, cur = cur.parentElement) {
    const style = (cur as HTMLElement).style;
    if (!style) continue;
    if (style.textDecoration?.includes('line-through')) return true;
    if (style.textDecorationLine?.includes('line-through')) return true;
  }

  // 4. Computed style — most reliable in real browser; happy-dom may return empty strings (no-op).
  const win = (el.ownerDocument?.defaultView as (Window & typeof globalThis) | null) ?? null;
  if (win && typeof win.getComputedStyle === 'function') {
    cur = el;
    for (let depth = 0; cur && depth < 8; depth++, cur = cur.parentElement) {
      try {
        const cs = win.getComputedStyle(cur as Element);
        const td = cs.textDecorationLine || cs.textDecoration || '';
        if (td.includes('line-through')) return true;
      } catch {
        break;
      }
    }
  }

  return false;
}

interface PriceCandidate {
  price: number;
  isStrikethrough: boolean;
  domOrder: number;
}

/**
 * Walk through a price block, collect every leaf-element whose direct text is a pure money value.
 * Returns up to 3 tiers:
 *  - «discounted» — the cheapest visible price (Ozon Card / «С банками»)
 *  - «regular»   — middle price (without bank discount, «С другими банками»)
 *  - «original»  — the highest, often visually struck-through («Без скидки»)
 *
 * Labels are taken verbatim from the page when possible; otherwise sensible defaults are used.
 * Installment / cashback / shipping text is filtered out.
 */
function extractPriceTiersFromBlock(block: HTMLElement): PriceTier[] {
  const candidates: PriceCandidate[] = [];
  let order = 0;
  const seenPrices = new Set<string>();

  const walker = block.querySelectorAll<HTMLElement>('span, div, b, strong, s, del');
  for (const el of walker) {
    const t = directText(el);
    if (!t) continue;
    if (PRICE_NOISE_RE.test(t)) continue;
    if (!PURE_PRICE_RE.test(t)) continue;

    const price = parsePriceText(t);
    if (price == null || price < 1 || price > 100_000_000) continue;

    const isStrikethrough = hasStrikethrough(el);
    const key = `${price}|${isStrikethrough ? 'S' : 'N'}`;
    if (seenPrices.has(key)) continue;
    seenPrices.add(key);

    candidates.push({ price, isStrikethrough, domOrder: order++ });
  }

  if (candidates.length === 0) return [];

  const blockText = (block.textContent ?? '').replace(/\s+/g, ' ');
  // Note: JavaScript `\b` is ASCII-only and won't match a boundary after Cyrillic «и» — so we don't
  // rely on word boundaries here. The phrasing alone is unambiguous: "С банками" doesn't match
  // "С другими банками" because "другими" sits between «С» and «банками».
  // Display labels are normalized — the page's "С банками" wording is opaque to users not paying
  // through Ozon's bank partners; we surface it as "С Ozon Картой" since that's the same tier
  // for everyone with an Ozon Card and the brand-recognizable name.
  const rawDiscounted = pickLabelFromText(blockText, [
    /С\s+Ozon\s+Карт(?:ой|ы)?/i,
    /Ozon\s+Premium/i,
    /С\s+банками/i,
  ]);
  const labelDiscounted = rawDiscounted && /С\s+банками/i.test(rawDiscounted)
    ? 'С Ozon Картой'
    : rawDiscounted;
  const rawRegular = pickLabelFromText(blockText, [
    /Без\s+Ozon\s+Карт(?:ы)?/i,
    /С\s+другими\s+банками/i,
    /Обычная\s+цена/i,
  ]);
  const labelRegular = rawRegular && /С\s+другими\s+банками/i.test(rawRegular)
    ? 'Без Ozon Карты'
    : rawRegular;

  const uniquePricesAsc = Array.from(new Set(candidates.map((c) => c.price))).sort((a, b) => a - b);

  if (uniquePricesAsc.length === 1) {
    return [{ label: 'Цена', amount: uniquePricesAsc[0]!, kind: 'regular' }];
  }

  if (uniquePricesAsc.length === 2) {
    return [
      { label: labelDiscounted ?? 'Со скидкой', amount: uniquePricesAsc[0]!, kind: 'discounted' },
      { label: 'Без скидки', amount: uniquePricesAsc[1]!, kind: 'original' },
    ];
  }

  // 3 or more tiers — keep the lowest, the highest, and the middle one closest to the median.
  const min = uniquePricesAsc[0]!;
  const max = uniquePricesAsc[uniquePricesAsc.length - 1]!;
  const middle = uniquePricesAsc[Math.floor((uniquePricesAsc.length - 1) / 2)]!;

  return [
    { label: labelDiscounted ?? 'Со скидкой', amount: min, kind: 'discounted' },
    { label: labelRegular ?? 'Обычная цена', amount: middle, kind: 'regular' },
    { label: 'Без скидки', amount: max, kind: 'original' },
  ];
}

function pickLabelFromText(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

function deriveCurrentAndOld(tiers: PriceTier[]): { current: number | null; old: number | null } {
  if (tiers.length === 0) return { current: null, old: null };
  const current = tiers.find((t) => t.kind === 'discounted')?.amount ?? tiers[0]!.amount;
  const original = tiers.find((t) => t.kind === 'original')?.amount;
  const old = original != null && original > current ? original : null;
  return { current, old };
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

function extractReviewCountFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /(\d[\d\s]*)/.exec(text.replace(/ /g, ' '));
  if (!m) return null;
  const n = parseInt(m[1]!.replace(/\s+/g, ''), 10);
  return Number.isFinite(n) ? n : null;
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

  // <dl><dt>Объём</dt><dd>1.7 л</dd>...</dl>
  const dts = block.querySelectorAll<HTMLElement>('dl dt');
  for (const dt of dts) {
    const dd = dt.nextElementSibling;
    if (dd && dd.tagName === 'DD') {
      push(dt.textContent ?? '', dd.textContent ?? '');
      if (specs.length >= MAX_SPECS) break;
    }
  }

  // <table><tr><th>Объём</th><td>1.7 л</td></tr></table> or <tr><td>name</td><td>value</td></tr>
  if (specs.length < MAX_SPECS) {
    const rows = block.querySelectorAll<HTMLElement>('tr');
    for (const tr of rows) {
      const cells = tr.children;
      if (cells.length < 2) continue;
      push(cells[0]!.textContent ?? '', cells[1]!.textContent ?? '');
      if (specs.length >= MAX_SPECS) break;
    }
  }

  // Generic Ozon layout: pairs of sibling <div>/<span> with class containing "key" and "value"
  if (specs.length < MAX_SPECS) {
    const keyNodes = block.querySelectorAll<HTMLElement>('[class*="Key"], [class*="key"], [class*="Name"]');
    for (const k of keyNodes) {
      const v = k.nextElementSibling as HTMLElement | null;
      if (!v) continue;
      const cv = (v.className && typeof v.className === 'string' ? v.className : '') as string;
      if (!/Value|value|Cell/.test(cv)) continue;
      push(k.textContent ?? '', v.textContent ?? '');
      if (specs.length >= MAX_SPECS) break;
    }
  }

  return specs;
}

function extractDescription(block: HTMLElement): string | undefined {
  const text = block.textContent?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_DESCRIPTION_CHARS ? text.slice(0, MAX_DESCRIPTION_CHARS) : text;
}

function pickLongest(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

/**
 * Walk the entire document looking for the largest struck-through ruble price > current.
 * Used as a fallback when Ozon places the «old» price outside the standard webPrice block.
 */
function findStruckPriceAnywhere(doc: Document, currentPrice: number): number | null {
  const candidates = doc.querySelectorAll<HTMLElement>('span, div, s, del, strike, b, strong');
  let best: number | null = null;
  for (const el of candidates) {
    const t = directText(el);
    if (!t || !PURE_PRICE_RE.test(t)) continue;
    if (PRICE_NOISE_RE.test(t)) continue;
    const price = parsePriceText(t);
    if (price == null || price <= currentPrice || price > 100_000_000) continue;
    if (!hasStrikethrough(el)) continue;
    if (best == null || price > best) best = price;
  }
  return best;
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

  if (typeof product.image === 'string') result.imageUrl = upgradeOzonImageUrl(product.image);
  else if (Array.isArray(product.image) && product.image.length > 0) {
    result.imageUrl = upgradeOzonImageUrl(product.image[0]!);
  }

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

  const titleEl = firstMatch<HTMLElement>(doc, OZON_SELECTORS.title);
  if (titleEl) {
    const text = titleEl.textContent?.trim();
    if (text) result.title = text;
  }

  // 1. Try the canonical price blocks first — pick the block with the most tiers.
  let bestTiers: PriceTier[] = [];
  for (const sel of OZON_SELECTORS.priceBlock) {
    const block = doc.querySelector<HTMLElement>(sel);
    if (!block) continue;
    const tiers = extractPriceTiersFromBlock(block);
    if (tiers.length > bestTiers.length) bestTiers = tiers;
    if (bestTiers.length >= 3) break;
  }

  if (bestTiers.length > 0) {
    result.priceTiers = bestTiers;
    const { current, old } = deriveCurrentAndOld(bestTiers);
    result.currentPrice = current;
    result.oldPrice = old;
  }

  // 2. If we still don't have an old (struck-through) price, scan the entire document
  // for a struck-through ruble price. Useful when the «без скидки» tier is rendered outside webPrice.
  if (result.oldPrice == null && result.currentPrice != null) {
    const fallbackOld = findStruckPriceAnywhere(doc, result.currentPrice);
    if (fallbackOld != null) {
      result.oldPrice = fallbackOld;
      const tiers = result.priceTiers ?? [
        { label: 'Цена', amount: result.currentPrice, kind: 'regular' as const },
      ];
      // promote the existing single tier to «discounted» and append «Без скидки»
      const next: PriceTier[] = [
        { ...tiers[0]!, kind: 'discounted', label: tiers[0]!.label === 'Цена' ? 'Со скидкой' : tiers[0]!.label },
        { label: 'Без скидки', amount: fallbackOld, kind: 'original' },
      ];
      result.priceTiers = next;
    }
  }

  const imageEl = firstMatch<HTMLImageElement>(doc, OZON_SELECTORS.image);
  if (imageEl?.src) result.imageUrl = upgradeOzonImageUrl(imageEl.src);

  const ratingEl = firstMatch<HTMLElement>(doc, OZON_SELECTORS.rating);
  if (ratingEl) {
    const r = ratingEl.getAttribute('data-rating') ?? ratingEl.textContent;
    const num = parsePriceText(r);
    if (num != null) result.rating = num;
  }

  const reviewEl = firstMatch<HTMLElement>(doc, OZON_SELECTORS.reviewCount);
  if (reviewEl) {
    const n = extractReviewCountFromText(reviewEl.textContent);
    if (n != null) result.reviewCount = n;
  }

  const descEl = firstMatch<HTMLElement>(doc, OZON_SELECTORS.description);
  if (descEl) {
    const d = extractDescription(descEl);
    if (d) result.description = d;
  }

  const charBlock = firstMatch<HTMLElement>(doc, OZON_SELECTORS.characteristics);
  if (charBlock) {
    const specs = extractSpecs(charBlock);
    if (specs.length > 0) result.specs = specs;
  }

  return result;
}

export function extractOzonProduct(doc: Document, url: URL): ParsedProduct | null {
  if (!isOzonProductPage(url)) return null;

  const fromLd = fromJsonLd(doc) ?? {};
  const fromHtml = fromDom(doc);

  // DOM trumps JSON-LD for prices: JSON-LD often shows the base price (without Ozon Card discount),
  // DOM shows what the user actually sees. JSON-LD wins for static metadata (title, brand, sku).
  // Prefer the longer of two titles (DOM h1 is often more complete than JSON-LD `name`).
  const title = pickLongest(fromHtml.title, fromLd.title);

  const merged: Partial<ParsedProduct> = {
    title,
    brand: fromLd.brand,
    imageUrl: fromHtml.imageUrl || fromLd.imageUrl,
    sku: fromLd.sku ?? extractSkuFromPath(url.pathname),
    currentPrice: fromHtml.currentPrice ?? fromLd.currentPrice ?? null,
    oldPrice: fromHtml.oldPrice ?? null,
    availability: fromLd.availability,
    priceTiers: fromHtml.priceTiers,
    rating: fromLd.rating ?? fromHtml.rating,
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
    marketplace: 'ozon',
    url: url.toString(),
    canonicalUrl: canonicalProductUrl('ozon', url.toString()),
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
    missingFields: missing.length > 0 ? missing : undefined,
  };
}
