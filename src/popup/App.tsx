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

export function App() {
  const [tab, setTab] = useState<TabState>({ kind: 'loading' });
  const [recent, setRecent] = useState<Product[]>([]);

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
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'pricewatch:requestAdd' });
      setTimeout(refresh, 300);
    } catch (err) {
      console.error('[popup] askPageToAdd failed', err);
    }
  }

  async function remove(productId: string) {
    await sendRpc('product/remove', { productId });
    refresh();
  }

  function openDashboard() {
    const url = chrome.runtime.getURL('src/dashboard/index.html');
    chrome.tabs.create({ url });
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
          <button
            className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
            onClick={() => askPageToAdd(tab.tabId)}
          >
            Добавить текущий товар
          </button>
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

      <button
        className="w-full rounded-md border border-brand-500 px-3 py-2 text-sm font-medium text-brand-500 hover:bg-brand-50"
        onClick={openDashboard}
      >
        Открыть Dashboard
      </button>

      <section>
        <h2 className="text-xs font-semibold uppercase text-slate-500">Последние</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Пока нет отслеживаемых товаров.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recent.map((p) => (
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
