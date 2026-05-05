import type { Availability, ParsedProduct } from '@/shared/types';
import { canonicalizeUrl } from '@/shared/url';

const API_PARSER_VERSION = 2;

const NM_RE = /^\/catalog\/(\d+)\/detail\.aspx/i;

interface WbApiPrice {
  basic?: number;
  product?: number;
  total?: number;
}

interface WbApiSize {
  name?: string;
  origName?: string;
  stocks?: Array<{ qty?: number }>;
  price?: WbApiPrice;
}

interface WbApiProduct {
  id?: number;
  name?: string;
  brand?: string;
  rating?: number;
  reviewRating?: number;
  feedbacks?: number;
  nmFeedbacks?: number;
  pics?: number;
  totalQuantity?: number;
  sizes?: WbApiSize[];
}

interface WbApiResponse {
  products?: WbApiProduct[];
}

/**
 * Map nm → image URL using the `basket-XX.wbbasket.ru` CDN scheme.
 * Basket boundaries are derived from observed traffic; expand as new ones appear.
 */
function buildImageUrl(id: number): string {
  const vol = Math.floor(id / 1e5);
  const part = Math.floor(id / 1e3);
  const basket = (() => {
    if (vol <= 143) return '01';
    if (vol <= 287) return '02';
    if (vol <= 431) return '03';
    if (vol <= 719) return '04';
    if (vol <= 1007) return '05';
    if (vol <= 1061) return '06';
    if (vol <= 1115) return '07';
    if (vol <= 1169) return '08';
    if (vol <= 1313) return '09';
    if (vol <= 1601) return '10';
    if (vol <= 1655) return '11';
    if (vol <= 1919) return '12';
    if (vol <= 2045) return '13';
    if (vol <= 2189) return '14';
    if (vol <= 2405) return '15';
    if (vol <= 2621) return '16';
    if (vol <= 2837) return '17';
    if (vol <= 3053) return '18';
    if (vol <= 3269) return '19';
    if (vol <= 3485) return '20';
    return '21';
  })();
  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${id}/images/big/1.webp`;
}

export function extractNmFromUrl(url: URL): number | null {
  const m = NM_RE.exec(url.pathname);
  if (!m) return null;
  const nm = parseInt(m[1]!, 10);
  return Number.isFinite(nm) ? nm : null;
}

/**
 * Fetch product data from WB's public catalog API. Returns null on network/CORS errors,
 * 404, archived items, or any unexpected payload. The caller falls back to DOM parsing.
 *
 * `dest=-1257786` is a Moscow region ID; sufficient for MVP. Per-region prices come later.
 */
export async function fetchWbProductFromApi(nm: number, url: URL): Promise<ParsedProduct | null> {
  const apiUrl =
    `https://u-card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786` +
    `&hide_dtype=10;13;14&ab_testing=false&nm=${nm}`;
  let resp: Response;
  try {
    resp = await fetch(apiUrl, { credentials: 'omit' });
  } catch {
    return null;
  }
  if (!resp.ok) return null;

  let data: WbApiResponse;
  try {
    data = (await resp.json()) as WbApiResponse;
  } catch {
    return null;
  }

  const product = data.products?.[0];
  if (!product || product.id == null) return null;

  const size = product.sizes?.[0];
  const productPrice = size?.price?.product;
  const basicPrice = size?.price?.basic;
  if (productPrice == null) return null;

  const currentPrice = Math.round(productPrice / 100);
  const oldPrice =
    basicPrice != null && basicPrice > productPrice ? Math.round(basicPrice / 100) : null;
  const discountPct =
    oldPrice != null ? Math.round(((oldPrice - currentPrice) / oldPrice) * 100) : null;

  const totalQty = product.totalQuantity ?? 0;
  const availability: Availability = totalQty > 0 ? 'in_stock' : 'out_of_stock';

  const rating = product.reviewRating ?? product.rating;
  const reviewCount = product.nmFeedbacks ?? product.feedbacks;

  return {
    marketplace: 'wildberries',
    url: url.toString(),
    canonicalUrl: canonicalizeUrl(url.toString()),
    sku: String(product.id),
    title: product.name ?? `Товар ${product.id}`,
    brand: product.brand,
    imageUrl: buildImageUrl(product.id),
    currentPrice,
    oldPrice,
    discountPct,
    availability,
    rating,
    reviewCount,
    parserVersion: API_PARSER_VERSION,
    parserStatus: 'ok',
  };
}
