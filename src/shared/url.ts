import type { Marketplace } from './types';
import { MARKETPLACE_HOSTS } from './constants';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'sortIdx', 'asb', 'asb2', '_bctx', 'avtc', 'avte', 'avts', 'miniapp',
  'from', 'sh', 'context', 'fromSearch', 'reqId', 'requestId',
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
 * Strip tracking params and normalize host so that the same product page
 * always produces the same canonical URL (used as dedup key).
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
