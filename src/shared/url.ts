import type { Marketplace } from './types';
import { MARKETPLACES, MARKETPLACE_HOSTS } from './constants';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'sortIdx', 'asb', 'asb2', '_bctx', 'avtc', 'avte', 'avts', 'miniapp',
  'from', 'sh', 'context', 'fromSearch', 'reqId', 'requestId',
  // Wildberries
  'targetUrl', 'sort', 'page', 'size', 'color',
  // Ozon
  'oos_search', 'tab', 'seller', 'at', 'abt', 'ab',
  // Yandex Market
  'sku', 'uniqueId', 'do-waremd5', 'nid', 'show-uid',
  'clid', 'pp', 'mclid', 'distr_type', 'erid', 'vid',
  // Common
  'text',
]);

export function detectMarketplace(url: string): Marketplace | null {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  for (const [mp, hosts] of Object.entries(MARKETPLACE_HOSTS)) {
    if (hosts.includes(host)) return mp as Marketplace;
  }
  return null;
}

/**
 * Build a stable canonical product URL for deduplication.
 * Strips slugs, query params, and marketplace-specific noise so that
 * the same product is always keyed by the same URL regardless of how
 * the user arrived at the page.
 */
export function canonicalProductUrl(marketplace: Marketplace, rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.host.replace(/^www\./, '');
    const base = `${u.protocol}//${host}`;
    const pathname = u.pathname;

    switch (marketplace) {
      case 'ozon': {
        // /product/<slug>-<id>/ → /product/-<id>/
        const m = /^\/product\/[^/]*-(\d+)\/?$/i.exec(pathname);
        if (m && m[1]) {
          return `${base}/product/-${m[1]}/`;
        }
        break;
      }
      case 'wildberries': {
        // /catalog/<id>/detail.aspx → keep path, drop query
        const m = /^\/catalog\/(\d+)\/detail\.aspx/i.exec(pathname);
        if (m && m[1]) {
          return `${base}/catalog/${m[1]}/detail.aspx`;
        }
        break;
      }
      case 'yandex-market': {
        // /product--<slug>/<id> | /product/<slug>/<id> | /card/<slug>/<id>
        // → /product/<id>
        const m = /^\/(?:card|product)(?:--[^/]+)?(?:\/[^/]+)?\/(\d+)/i.exec(pathname);
        if (m && m[1]) {
          return `${base}/product/${m[1]}`;
        }
        break;
      }
    }

    // Fallback for non-product paths or unrecognized shapes.
    return canonicalizeUrl(rawUrl);
  } catch {
    return rawUrl;
  }
}

/**
 * Strip tracking params and normalize host so that the same product page
 * always produces the same canonical URL (used as dedup key).
 *
 * Prefer `canonicalProductUrl(marketplace, rawUrl)` for product URLs — it
 * normalizes slugs and drops marketplace-specific query noise.
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const params = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      if (!TRACKING_PARAMS.has(k)) params.append(k, v);
    }
    const search = params.toString();
    const host = u.host.replace(/^www\./, '');
    const pathname = u.pathname.replace(/\/+$/, '/');
    return `${u.protocol}//${host}${pathname}${search ? `?${search}` : ''}`;
  } catch {
    return rawUrl;
  }
}

/**
 * Build the search-results URL for a marketplace. Used by the "open this
 * product on the other two marketplaces" feature — we don't try to match a
 * specific SKU across sites (impossible without a cross-marketplace catalog),
 * we just hand the user the search page with their copied title pre-filled.
 */
export function marketplaceSearchUrl(marketplace: Marketplace, query: string): string {
  const q = encodeURIComponent(query);
  switch (marketplace) {
    case 'ozon':
      return `https://www.ozon.ru/search/?text=${q}`;
    case 'wildberries':
      return `https://www.wildberries.ru/catalog/0/search.aspx?search=${q}`;
    case 'yandex-market':
      return `https://market.yandex.ru/search?text=${q}`;
  }
}

/** Marketplaces other than `current` — used to render "look up on X / Y" buttons. */
export function otherMarketplaces(current: Marketplace): Marketplace[] {
  return MARKETPLACES.filter((m) => m !== current);
}

/**
 * Best-effort: copy title to clipboard and open the target marketplace's
 * search page in a new tab. We do both — clipboard, so the user can paste a
 * refined query if the auto-search misses; new tab, so the search appears
 * pre-filled. Failures (clipboard denied, popup blocked) are swallowed —
 * worst case the user still has the new tab.
 */
export async function searchOnMarketplace(
  target: Marketplace,
  title: string,
): Promise<void> {
  try {
    await navigator.clipboard?.writeText(title);
  } catch {
    // ignore — clipboard may be blocked in some contexts.
  }
  try {
    window.open(marketplaceSearchUrl(target, title), '_blank', 'noopener,noreferrer');
  } catch {
    // ignore — popup blocker.
  }
}
