import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import { canonicalizeUrl, detectMarketplace } from '@/shared/url';
import { formatPrice, formatDateTime } from '@/shared/format';
import { MARKETPLACE_LABELS } from '@/shared/constants';
import type { Product } from '@/shared/types';

type TabState =
  | { kind: 'loading' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'tracked'; product: Product; tabId: number; url: string }
  | { kind: 'untracked'; tabId: number; url: string };

const ADD_ERROR_LABELS: Record<string, string> = {
  not_product_page: 'Это не страница карточки товара.',
  parser_failed: 'Не удалось распознать карточку (вёрстка изменилась или капча).',
  no_price: 'Цена не найдена на странице — попробуйте обновить страницу.',
};

export function App() {
  const [tab, setTab] = useState<TabState>({ kind: 'loading' });
  const [recent, setRecent] = useState<Product[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(() => new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkSummary, setBulkSummary] = useState<{ ok: number; fail: number; changes: number } | null>(null);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.url || !activeTab.id) {
        setTab({ kind: 'unsupported', reason: 'Нет активной вкладки.' });
        return;
      }
      const mp = detectMarketplace(activeTab.url);
      if (!mp) {
        setTab({ kind: 'unsupported', reason: 'Эта страница не на поддерживаемом маркетплейсе.' });
      } else {
        const canonical = canonicalizeUrl(activeTab.url);
        const { product } = await sendRpc('product/getByCanonical', { canonicalUrl: canonical });
        if (product) setTab({ kind: 'tracked', product, tabId: activeTab.id, url: activeTab.url });
        else setTab({ kind: 'untracked', tabId: activeTab.id, url: activeTab.url });
      }
      const { products } = await sendRpc('product/list', { limit: 5 });
      setRecent(products);
    } catch (err) {
      console.warn('[popup] refresh failed', err);
    }
  }

  async function askPageToAdd(tabId: number) {
    setAddError(null);
    try {
      const resp = (await chrome.tabs.sendMessage(tabId, {
        type: 'pricewatch:requestAdd',
      })) as { ok?: boolean; reason?: string } | undefined;
      if (resp && resp.ok === false) {
        const reason = resp.reason ?? 'unknown';
        setAddError(ADD_ERROR_LABELS[reason] ?? `Не удалось добавить: ${reason}`);
      }
      setTimeout(refresh, 300);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The most common case: "Could not establish connection. Receiving end does not exist."
      // means the content script didn't load on this page (host_permissions or page navigation race).
      setAddError(
        /Receiving end/.test(msg)
          ? 'Расширение не подключилось к странице. Обновите её (F5) и попробуйте снова.'
          : msg,
      );
    }
  }

  async function remove(productId: string) {
    await sendRpc('product/remove', { productId });
    refresh();
  }

  async function refreshProduct(productId: string) {
    setRefreshingIds((prev) => {
      const next = new Set(prev);
      next.add(productId);
      return next;
    });
    try {
      await sendRpc('product/refresh', { productId });
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
      refresh();
    }
  }

  function openDashboard() {
    const url = chrome.runtime.getURL('src/dashboard/index.html');
    chrome.tabs.create({ url });
  }

  async function refreshAll() {
    if (bulkProgress != null) return;
    const all = await sendRpc('product/list', { archived: false });
    const products = all.products;
    if (products.length === 0) return;
    setBulkSummary(null);
    setBulkProgress({ done: 0, total: products.length });
    let ok = 0;
    let fail = 0;
    let changes = 0;
    for (let i = 0; i < products.length; i++) {
      const p = products[i]!;
      const before = p.currentPrice;
      try {
        const resp = await sendRpc('product/refresh', { productId: p.id });
        if ('ok' in resp && resp.ok) {
          ok++;
          if (before != null && resp.product.currentPrice != null && resp.product.currentPrice !== before) {
            changes++;
          }
        } else {
          fail++;
        }
      } catch {
        fail++;
      }
      setBulkProgress({ done: i + 1, total: products.length });
    }
    setBulkProgress(null);
    setBulkSummary({ ok, fail, changes });
    refresh();
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">PriceWatch</h1>
        <div className="flex items-center gap-3">
          <button
            className="text-xs text-brand-500 hover:underline"
            onClick={openDashboard}
          >
            Dashboard
          </button>
          <button
            className="text-xs text-slate-500 hover:underline"
            onClick={() => chrome.runtime.openOptionsPage()}
          >
            Настройки
          </button>
        </div>
      </header>

      <section>
        {tab.kind === 'loading' && <p className="text-sm text-slate-500">Загрузка…</p>}

        {tab.kind === 'unsupported' && (
          <p className="text-sm text-slate-500">{tab.reason}</p>
        )}

        {tab.kind === 'untracked' && (
          <>
            <button
              className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
              onClick={() => askPageToAdd(tab.tabId)}
            >
              Добавить текущий товар
            </button>
            {addError && (
              <p className="mt-2 text-xs text-rose-600">{addError}</p>
            )}
          </>
        )}

        {tab.kind === 'tracked' && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="font-medium">Уже отслеживается</div>
            <div className="mt-1 text-xs text-emerald-800/80">
              {MARKETPLACE_LABELS[tab.product.marketplace]} · {formatPrice(tab.product.currentPrice)}
            </div>
            <button
              className="mt-2 text-xs text-emerald-700 hover:underline"
              onClick={() => remove(tab.product.id)}
            >
              Перестать отслеживать
            </button>
          </div>
        )}
      </section>

      <div className="flex gap-2">
        <button
          className="flex-1 rounded-md border border-brand-500 px-3 py-2 text-sm font-medium text-brand-500 hover:bg-brand-50"
          onClick={openDashboard}
        >
          Открыть Dashboard
        </button>
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={bulkProgress != null}
          title="Обновить все отслеживаемые товары"
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PopupIcon name="refresh" spinning={bulkProgress != null} />
          {bulkProgress
            ? `${bulkProgress.done}/${bulkProgress.total}`
            : 'Все'}
        </button>
      </div>
      {bulkSummary && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Обновлено {bulkSummary.ok}, изменилось цен: {bulkSummary.changes}
          {bulkSummary.fail > 0 && (
            <span className="text-rose-600"> · ошибок {bulkSummary.fail}</span>
          )}
        </div>
      )}

      <section>
        <h2 className="text-xs font-semibold uppercase text-slate-500">Последние</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Пока нет отслеживаемых товаров.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recent.map((p) => {
              const isRefreshing = refreshingIds.has(p.id);
              return (
                <li key={p.id} className="rounded-md border border-slate-200 p-2 text-sm">
                  <div className="flex items-start gap-2">
                    {p.imageUrl && (
                      <img src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="line-clamp-2 text-slate-900 hover:underline"
                      >
                        {p.title}
                      </a>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {MARKETPLACE_LABELS[p.marketplace]} · {formatPrice(p.currentPrice)} ·{' '}
                        {formatDateTime(p.updatedAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Открыть"
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <PopupIcon name="open" />
                      </a>
                      <button
                        type="button"
                        onClick={() => void refreshProduct(p.id)}
                        disabled={isRefreshing}
                        title="Обновить цену"
                        className={`flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 ${
                          isRefreshing ? 'text-brand-500' : ''
                        }`}
                      >
                        <PopupIcon name="refresh" spinning={isRefreshing} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Удалить «${p.title}»?`)) void remove(p.id);
                        }}
                        title="Удалить"
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <PopupIcon name="trash" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function PopupIcon({
  name,
  spinning = false,
}: {
  name: 'open' | 'refresh' | 'trash';
  spinning?: boolean;
}) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: spinning ? 'animate-spin' : undefined,
  };
  if (name === 'open') {
    return (
      <svg {...common}>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    );
  }
  if (name === 'refresh') {
    return (
      <svg {...common}>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
