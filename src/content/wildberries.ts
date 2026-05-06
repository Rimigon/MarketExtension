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

/**
 * In hidden-tab refresh mode the page may not have rendered the wallet price
 * element yet by the time we probe. Poll the DOM for up to `timeoutMs`,
 * returning as soon as a wallet price appears (typically <2s after navigation).
 * Returns null if it never shows up — e.g. the user is signed out, the
 * product has no wallet discount, or this isn't a hidden tab and the SPA
 * stripped the element.
 */
async function waitForWalletPriceFromDom(timeoutMs: number): Promise<number | null> {
  const start = Date.now();
  let interval = 200;
  while (Date.now() - start < timeoutMs) {
    const wallet = readWalletPriceFromDom();
    if (wallet != null) return wallet;
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval + 100, 600);
  }
  return null;
}

async function augmentWithWalletPrice(
  parsed: ParsedProduct,
  waitForDomMs = 0,
): Promise<ParsedProduct> {
  const wallet =
    waitForDomMs > 0 ? await waitForWalletPriceFromDom(waitForDomMs) : readWalletPriceFromDom();
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

// In hidden-tab refresh mode the page just navigated, the wallet price element
// may take a couple of seconds to render. Wait for it. In normal page-mode the
// content script already waits via MutationObserver before calling enrich, so
// the wallet element is present and the read returns synchronously fast.
const isHiddenTab = location.hash === '#__pwHidden';
const WALLET_DOM_WAIT_MS = isHiddenTab ? 8000 : 0;

runContentScript(wildberriesParser, 'wildberries', {
  enrich: async (url) => {
    const nm = extractNmFromUrl(url);
    if (nm == null) return null;
    const parsed = await fetchWbProductFromApi(nm, url);
    if (!parsed) return null;
    return augmentWithWalletPrice(parsed, WALLET_DOM_WAIT_MS);
  },
});
