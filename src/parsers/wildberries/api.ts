import type {
  Availability,
  ParsedProduct,
  PriceTier,
  ProductSpec,
} from '@/shared/types';
import { canonicalProductUrl } from '@/shared/url';

const API_PARSER_VERSION = 3;
const MAX_DESCRIPTION_CHARS = 5000;
const MAX_SPECS = 100;

const NM_RE = /^\/catalog\/(\d+)\/detail\.aspx/i;

interface WbApiPrice {
  /** Original (without any discount), in kopeks. */
  basic?: number;
  /** Sale price without WB Wallet, in kopeks. */
  product?: number;
  /** Same as product on v4 — kept for back-compat. */
  total?: number;
  /** Some v4 responses surface the wallet price here. */
  walletPrice?: number;
  /** Wallet discount percent applied to product → walletPrice. */
  walletDiscount?: number;
}

interface WbApiSize {
  name?: string;
  origName?: string;
  stocks?: Array<{ qty?: number }>;
  price?: WbApiPrice;
}

interface WbApiExtended {
  /** Legacy client (= WB Wallet) price in kopeks; still present on v4 responses. */
  clientPriceU?: number;
  /** Legacy client sale percentage. */
  clientSale?: number;
  basicPriceU?: number;
  basicSale?: number;
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
  extended?: WbApiExtended;
}

interface WbApiResponse {
  products?: WbApiProduct[];
}

interface WbCardJsonOption {
  name?: string;
  value?: string | number;
  charcType?: number;
}

interface WbCardJsonGroupedOption {
  name?: string;
  options?: WbCardJsonOption[];
}

interface WbCardJson {
  description?: string;
  options?: WbCardJsonOption[];
  grouped_options?: WbCardJsonGroupedOption[];
  full_name?: string;
}

interface BasketCoords {
  basket: string;
  vol: number;
  part: number;
}

function basketCoordsFor(id: number): BasketCoords {
  const vol = Math.floor(id / 1e5);
  const part = Math.floor(id / 1e3);
  // Ranges derived from observed traffic; expand as new baskets appear.
  let basket: string;
  if (vol <= 143) basket = '01';
  else if (vol <= 287) basket = '02';
  else if (vol <= 431) basket = '03';
  else if (vol <= 719) basket = '04';
  else if (vol <= 1007) basket = '05';
  else if (vol <= 1061) basket = '06';
  else if (vol <= 1115) basket = '07';
  else if (vol <= 1169) basket = '08';
  else if (vol <= 1313) basket = '09';
  else if (vol <= 1601) basket = '10';
  else if (vol <= 1655) basket = '11';
  else if (vol <= 1919) basket = '12';
  else if (vol <= 2045) basket = '13';
  else if (vol <= 2189) basket = '14';
  else if (vol <= 2405) basket = '15';
  else if (vol <= 2621) basket = '16';
  else if (vol <= 2837) basket = '17';
  else if (vol <= 3053) basket = '18';
  else if (vol <= 3269) basket = '19';
  else if (vol <= 3485) basket = '20';
  else basket = '21';
  return { basket, vol, part };
}

function buildImageUrl(coords: BasketCoords, id: number): string {
  return `https://basket-${coords.basket}.wbbasket.ru/vol${coords.vol}/part${coords.part}/${id}/images/big/1.webp`;
}

function buildCardJsonUrl(coords: BasketCoords, id: number): string {
  return `https://basket-${coords.basket}.wbbasket.ru/vol${coords.vol}/part${coords.part}/${id}/info/ru/card.json`;
}

export function extractNmFromUrl(url: URL): number | null {
  const m = NM_RE.exec(url.pathname);
  if (!m) return null;
  const nm = parseInt(m[1]!, 10);
  return Number.isFinite(nm) ? nm : null;
}

async function fetchCardJson(url: string): Promise<WbCardJson | null> {
  try {
    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) return null;
    return (await resp.json()) as WbCardJson;
  } catch {
    return null;
  }
}

function specsFromCardJson(card: WbCardJson): ProductSpec[] {
  const specs: ProductSpec[] = [];
  const seen = new Set<string>();

  const push = (name?: string, value?: string | number) => {
    if (specs.length >= MAX_SPECS) return;
    if (name == null || value == null) return;
    const n = String(name).trim().replace(/\s+/g, ' ');
    const v = String(value).trim().replace(/\s+/g, ' ');
    if (!n || !v || n.length > 200 || v.length > 1000) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    specs.push({ name: n, value: v });
  };

  for (const opt of card.options ?? []) push(opt.name, opt.value);
  for (const group of card.grouped_options ?? []) {
    for (const opt of group.options ?? []) push(opt.name, opt.value);
  }

  return specs;
}

function descriptionFromCardJson(card: WbCardJson): string | undefined {
  const raw = card.description;
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > MAX_DESCRIPTION_CHARS
    ? cleaned.slice(0, MAX_DESCRIPTION_CHARS)
    : cleaned;
}

/**
 * Resolve the WB Wallet price (lowest visible on the page) from whatever shape
 * the API decided to return today. Tries — in order:
 *   1. `size.price.walletPrice` (newer v4 responses)
 *   2. `product.extended.clientPriceU` (legacy v2 field, still served by v4)
 *   3. `product * (1 - walletDiscount/100)` if the percent is provided
 * Returns the price in **kopeks** (matching other API fields), or null if no wallet info is present.
 */
function resolveWalletPriceKopeks(
  price: WbApiPrice | undefined,
  extended: WbApiExtended | undefined,
): number | null {
  if (price?.walletPrice != null && price.walletPrice > 0) return price.walletPrice;
  if (extended?.clientPriceU != null && extended.clientPriceU > 0) return extended.clientPriceU;
  const productPrice = price?.product ?? price?.total;
  const walletPct = price?.walletDiscount ?? extended?.clientSale;
  if (productPrice != null && walletPct != null && walletPct > 0 && walletPct < 100) {
    return Math.round(productPrice * (1 - walletPct / 100));
  }
  return null;
}

function buildPriceTiers(
  price: WbApiPrice | undefined,
  extended: WbApiExtended | undefined,
): PriceTier[] {
  if (!price) return [];
  const tiers: PriceTier[] = [];
  const walletKopeks = resolveWalletPriceKopeks(price, extended);
  const productKopeks = price.product ?? price.total;

  if (walletKopeks != null) {
    tiers.push({
      label: 'С WB Кошельком',
      amount: Math.round(walletKopeks / 100),
      kind: 'discounted',
    });
  }
  if (productKopeks != null && (walletKopeks == null || productKopeks !== walletKopeks)) {
    tiers.push({
      label: 'Без WB Кошелька',
      amount: Math.round(productKopeks / 100),
      kind: walletKopeks == null ? 'discounted' : 'regular',
    });
  }
  if (price.basic != null && price.basic !== productKopeks) {
    tiers.push({
      label: 'Без скидки',
      amount: Math.round(price.basic / 100),
      kind: 'original',
    });
  }
  return tiers;
}

/**
 * Fetch product data from WB's public catalog API. Returns null on network/CORS errors,
 * 404, archived items, or any unexpected payload. The caller falls back to DOM parsing.
 *
 * `dest=-1257786` is a Moscow region ID; sufficient for MVP. Per-region prices come later.
 *
 * Headline price is `total` (with WB Wallet) — that's what the page shows prominently.
 * `product` (without wallet) and `basic` (no discount) are surfaced via priceTiers so the
 * detail UI can show all three.
 *
 * Description and specs come from the basket-CDN `card.json` blob; that fetch is best-effort
 * — if it fails, we still return the price/availability data, just without rich detail.
 */
export async function fetchWbProductFromApi(nm: number, url: URL): Promise<ParsedProduct | null> {
  const apiUrl =
    `https://u-card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786` +
    `&hide_dtype=10;13;14&ab_testing=false&nm=${nm}`;
  let resp: Response;
  try {
    // `credentials: 'include'` makes the content-script fetch carry the user's wb.ru cookies,
    // so when they're logged in the API answers with their personal WB-Wallet price.
    // CORS-safe — WB's API allows credentialed cross-origin fetches from wildberries.ru.
    resp = await fetch(apiUrl, { credentials: 'include' });
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
  const price = size?.price;
  const extended = product.extended;
  // Headline price preference: WB Wallet (cheapest visible) → product → basic.
  const walletKopeks = resolveWalletPriceKopeks(price, extended);
  const rawCurrent = walletKopeks ?? price?.product ?? price?.total ?? price?.basic;
  if (rawCurrent == null) return null;

  const currentPrice = Math.round(rawCurrent / 100);
  const basicPrice =
    price?.basic != null ? Math.round(price.basic / 100) : null;
  const oldPrice =
    basicPrice != null && basicPrice > currentPrice ? basicPrice : null;
  const discountPct =
    oldPrice != null ? Math.round(((oldPrice - currentPrice) / oldPrice) * 100) : null;

  const totalQty = product.totalQuantity ?? 0;
  const availability: Availability = totalQty > 0 ? 'in_stock' : 'out_of_stock';

  const rating = product.reviewRating ?? product.rating;
  const reviewCount = product.nmFeedbacks ?? product.feedbacks;

  const coords = basketCoordsFor(product.id);
  const card = await fetchCardJson(buildCardJsonUrl(coords, product.id));
  const description = card ? descriptionFromCardJson(card) : undefined;
  const specs = card ? specsFromCardJson(card) : [];

  return {
    marketplace: 'wildberries',
    url: url.toString(),
    canonicalUrl: canonicalProductUrl('wildberries', url.toString()),
    sku: String(product.id),
    title: product.name ?? `Товар ${product.id}`,
    brand: product.brand,
    imageUrl: buildImageUrl(coords, product.id),
    currentPrice,
    oldPrice,
    discountPct,
    availability,
    priceTiers: buildPriceTiers(price, extended),
    rating,
    reviewCount,
    description,
    specs: specs.length > 0 ? specs : undefined,
    parserVersion: API_PARSER_VERSION,
    parserStatus: 'ok',
  };
}
