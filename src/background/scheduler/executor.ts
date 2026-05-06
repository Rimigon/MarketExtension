import type { Marketplace, ParsedProduct } from '@/shared/types';
import { extractNmFromUrl, fetchWbProductFromApi } from '@/parsers/wildberries/api';

export interface ExecutorOk {
  ok: true;
  parsed: ParsedProduct;
}

export interface ExecutorFail {
  ok: false;
  error: string;
}

export type ExecutorResult = ExecutorOk | ExecutorFail;

/**
 * Run a scheduled update for a single product. Currently supports the "light"
 * path only — Wildberries via its public catalog API. Heavy marketplaces
 * (Ozon, Yandex Market) require parsing through a hidden tab; that path is
 * deferred to V1 (see roadmap) and returns `not_implemented` for now so the
 * scheduler can drop them gracefully.
 */
export async function execute(
  marketplace: Marketplace,
  url: string,
): Promise<ExecutorResult> {
  switch (marketplace) {
    case 'wildberries':
      return executeWildberries(url);
    case 'ozon':
    case 'yandex-market':
      return { ok: false, error: 'not_implemented:tab_refresh' };
  }
}

async function executeWildberries(url: string): Promise<ExecutorResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  const nm = extractNmFromUrl(parsedUrl);
  if (nm == null) return { ok: false, error: 'no_nm_in_url' };

  try {
    const parsed = await fetchWbProductFromApi(nm, parsedUrl);
    if (!parsed) return { ok: false, error: 'api_returned_null' };
    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
