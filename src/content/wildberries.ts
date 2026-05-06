import { wildberriesParser } from '@/parsers/wildberries';
import { extractNmFromUrl, fetchWbProductFromApi } from '@/parsers/wildberries/api';
import { parsePriceText } from '@/parsers/base';
import type { ParsedProduct, PriceTier } from '@/shared/types';
import { runContentScript } from './run';

/**
 * Wallet-price hooks across WB markup generations:
 *  - Legacy hyphenated BEM:  `.price-block__wallet-price`
 *  - 2025+ scoped camelCase: `priceBlockWalletPrice--XXXX`, `priceBlockPriceWrapWallet--XXXX`
 * The `i` flag lets attribute selectors match without caring about case (the WB class is
 * `WalletPrice` with capital W, so a lowercase substring would otherwise miss).
 */
const WALLET_PRICE_SELECTORS = [
  '[class*="priceBlockWalletPrice"]',
  '[class*="priceBlockPriceWrapWallet"]',
  '[class*="WalletPrice" i]',
  '[class*="wallet-price" i]',
  '.price-block__wallet-price',
];

/**
 * WB's `u-card.wb.ru/cards/v4/detail` no longer surfaces the WB-Wallet price (`product` and `basic`
 * only) — that figure is computed client-side and rendered into the DOM. We read it from there
 * and layer it on top of the API result so the headline price matches what the user actually sees.
 *
 * The wallet element on the new layout is a button that wraps an `<h2>` with the price text;
 * `textContent` flattens both into the same string, which `parsePriceText` then resolves.
 */
function readWalletPriceFromDom(): number | null {
  for (const sel of WALLET_PRICE_SELECTORS) {
    let nodes: NodeListOf<HTMLElement>;
    try {
      nodes = document.querySelectorAll<HTMLElement>(sel);
    } catch {
      continue; // older Chromium without case-insensitive flag — skip and try next.
    }
    for (const el of Array.from(nodes)) {
      const num = parsePriceText(el.textContent);
      if (num != null && num > 0 && num < 100_000_000) return num;
    }
  }
  return null;
}

function augmentWithWalletPrice(parsed: ParsedProduct): ParsedProduct {
  const wallet = readWalletPriceFromDom();
  if (wallet == null) return parsed;
  // No improvement to make if the wallet figure is the same/higher than what the API gave us.
  if (parsed.currentPrice != null && wallet >= parsed.currentPrice) return parsed;

  const productPrice = parsed.currentPrice;
  const tiers: PriceTier[] = [
    { label: 'С WB Кошельком', amount: wallet, kind: 'discounted' },
  ];
  if (productPrice != null && productPrice !== wallet) {
    tiers.push({ label: 'Без WB Кошелька', amount: productPrice, kind: 'regular' });
  }
  // Preserve a known «Без скидки» tier from the API-derived list, if any.
  for (const t of parsed.priceTiers ?? []) {
    if (t.kind === 'original' && !tiers.some((x) => x.amount === t.amount)) {
      tiers.push(t);
    }
  }

  const oldPrice = parsed.oldPrice;
  const discountPct =
    oldPrice != null && oldPrice > wallet
      ? Math.round(((oldPrice - wallet) / oldPrice) * 100)
      : null;

  return {
    ...parsed,
    currentPrice: wallet,
    discountPct,
    priceTiers: tiers,
  };
}

runContentScript(wildberriesParser, 'wildberries', {
  enrich: async (url) => {
    const nm = extractNmFromUrl(url);
    if (nm == null) return null;
    const parsed = await fetchWbProductFromApi(nm, url);
    if (!parsed) return null;
    return augmentWithWalletPrice(parsed);
  },
});
