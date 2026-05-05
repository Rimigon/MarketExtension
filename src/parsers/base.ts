import type { Marketplace, ParsedProduct } from '@/shared/types';

export interface Parser {
  marketplace: Marketplace;
  version: number;
  /** Should the content script become active on this URL? */
  isProductPage(url: URL): boolean;
  /** Pull all extractable fields from the live page document. Returns null if the page isn't a product page. */
  parse(doc: Document, url: URL): ParsedProduct | null;
  /** Anchor element near which the «Track» button should be injected. Null → use floating fallback. */
  extractAnchorElement(doc: Document): HTMLElement | null;
  /** Subscribe to SPA navigation. Returns a teardown function. */
  watchSpa(callback: (url: URL) => void): () => void;
}

/**
 * Patches history.pushState/replaceState once and emits a synthetic `pricewatch:locationchange` event
 * whenever the URL changes inside an SPA. Calling more than once is a no-op.
 */
let _spaPatched = false;
export function ensureSpaPatched(): void {
  if (_spaPatched) return;
  _spaPatched = true;
  const fire = () => window.dispatchEvent(new Event('pricewatch:locationchange'));
  for (const fn of ['pushState', 'replaceState'] as const) {
    const orig = history[fn];
    history[fn] = function (...args: Parameters<typeof orig>) {
      const ret = orig.apply(this, args);
      fire();
      return ret;
    };
  }
  window.addEventListener('popstate', fire);
}

export function makeSpaWatcher(): (cb: (url: URL) => void) => () => void {
  return (cb) => {
    ensureSpaPatched();
    const handler = () => cb(new URL(location.href));
    window.addEventListener('pricewatch:locationchange', handler);
    return () => window.removeEventListener('pricewatch:locationchange', handler);
  };
}

/**
 * JSON-LD <script type="application/ld+json"> nodes. Returns flat array of parsed objects,
 * each entry could be a Product, BreadcrumbList, Offer etc — caller decides what to use.
 */
export function readJsonLd(doc: Document): unknown[] {
  const out: unknown[] = [];
  const nodes = doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]');
  for (const node of nodes) {
    const text = node.textContent;
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // ignore broken JSON-LD blobs — sites occasionally ship them
    }
  }
  return out;
}

export function findJsonLdProduct(blocks: unknown[]): Record<string, unknown> | null {
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const obj = block as Record<string, unknown>;
    const type = obj['@type'];
    if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return obj;
    if (Array.isArray(obj['@graph'])) {
      const inner = findJsonLdProduct(obj['@graph']);
      if (inner) return inner;
    }
  }
  return null;
}

export function parsePriceText(text: string | null | undefined): number | null {
  if (!text) return null;
  // strip currency symbols, spaces, narrow no-break spaces; keep digits and decimal separators
  const cleaned = text.replace(/[^\d.,]/g, '').replace(/,/g, '.');
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}
