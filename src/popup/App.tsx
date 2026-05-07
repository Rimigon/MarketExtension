import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import { canonicalizeUrl, detectMarketplace } from '@/shared/url';
import { formatPrice, formatDateTime } from '@/shared/format';
import { MARKETPLACE_LABELS } from '@/shared/constants';
import { resolveThemeId } from '@/shared/themes';
import { SchedulerHint } from '@/dashboard/components/SchedulerHint';
import type { AppNotification, Product } from '@/shared/types';

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
  const [tracked, setTracked] = useState<Product[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [addError, setAddError] = useState<string | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(() => new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkSummary, setBulkSummary] = useState<{ ok: number; fail: number; changes: number } | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [refreshBump, setRefreshBump] = useState(0);

  // Apply the user's chosen theme to the popup root as well, so light/dark
  // themes are consistent across the popup, options page and dashboard.
  useEffect(() => {
    let cancelled = false;
    const applyFromSettings = async () => {
      try {
        const resp = await sendRpc('settings/get', {});
        if (cancelled) return;
        document.documentElement.setAttribute(
          'data-theme',
          resolveThemeId(resp.settings.theme),
        );
      } catch {
        // SW asleep on first open — fall back to default until refresh().
      }
    };
    void applyFromSettings();
    return () => {
      cancelled = true;
    };
  }, []);

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
      // Show every actively-tracked product (not just a slice). The list is
      // virtually-scrollable in the popup body, so volume isn't an issue.
      const { products } = await sendRpc('product/list', { archived: false });
      setTracked(products);
      const [notes, unread] = await Promise.all([
        sendRpc('notifications/list', { limit: 5 }),
        sendRpc('notifications/unreadCount', {}),
      ]);
      setNotifications(notes.items);
      setUnreadCount(unread.count);
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

  async function openProductInDashboard(productId: string) {
    // Try to reuse an existing dashboard tab via the SW; fall back to a fresh
    // tab if the SW is asleep / RPC fails (mirrors openNotification below).
    try {
      await sendRpc('dashboard/open', { productId });
    } catch {
      const base = chrome.runtime.getURL('src/dashboard/index.html');
      chrome.tabs.create({ url: `${base}#product/${encodeURIComponent(productId)}` });
    }
    window.close();
  }

  async function openNotification(id?: string) {
    try {
      await sendRpc('dashboard/open', id ? { notificationId: id } : {});
    } catch {
      // Fallback if SW is asleep / RPC fails — open a fresh tab with the hash.
      const base = chrome.runtime.getURL('src/dashboard/index.html');
      chrome.tabs.create({ url: id ? `${base}#notifications/${id}` : `${base}#notifications` });
    }
    window.close();
  }

  async function markAllNotificationsRead() {
    await sendRpc('notifications/markAllRead', {});
    refresh();
  }

  async function removeNotification(id: string) {
    await sendRpc('notifications/remove', { id });
    refresh();
  }

  async function removeAllNotifications() {
    if (!confirm(`Удалить все уведомления (${notifications.length})?`)) return;
    await sendRpc('notifications/removeAll', {});
    refresh();
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
    setRefreshBump((n) => n + 1);
    refresh();
  }

  return (
    <div className="p-4 space-y-4">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
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
        </div>
        <SchedulerHint bump={refreshBump} variant="pill" />
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
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase text-slate-500">
            Уведомления
            {unreadCount > 0 && (
              <span className="ml-2 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
                {unreadCount}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2 text-[11px]">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllNotificationsRead()}
                className="text-brand-500 hover:underline"
              >
                Прочитать всё
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={() => void removeAllNotifications()}
                className="text-rose-600 hover:underline"
              >
                Удалить всё
              </button>
            )}
            <button
              type="button"
              onClick={() => void openNotification()}
              className="text-slate-500 hover:underline"
            >
              Все →
            </button>
          </div>
        </div>
        {notifications.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Уведомлений пока нет.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {notifications.slice(0, 3).map((n) => {
              const unread = n.readAt == null;
              const isGlobal = n.productId === '_global';
              const product = !isGlobal ? tracked.find((p) => p.id === n.productId) : undefined;
              return (
                <li
                  key={n.id}
                  className={`group relative flex items-start gap-2 rounded-md border p-2 text-sm transition ${
                    unread
                      ? 'border-brand-200 bg-brand-50/50 hover:border-brand-300'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void openNotification(n.id)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    {isGlobal ? (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand-50 text-brand-500">
                        <PopupIcon name="refresh" />
                      </div>
                    ) : product?.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <div className="h-8 w-8 shrink-0 rounded bg-slate-100" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className={`line-clamp-1 ${
                            unread ? 'font-medium text-slate-900' : 'text-slate-700'
                          }`}
                        >
                          {n.title}
                        </span>
                        {unread && (
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                        )}
                      </div>
                      <div className="line-clamp-1 text-xs text-slate-500">{n.body}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {formatDateTime(n.createdAt)}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeNotification(n.id);
                    }}
                    title="Удалить уведомление"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <PopupIcon name="close" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase text-slate-500">
            Отслеживаемые
            <span className="ml-1.5 text-[10px] font-normal text-slate-400">
              {tracked.length}
            </span>
          </h2>
        </div>
        {tracked.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Пока нет отслеживаемых товаров.</p>
        ) : (
          <>
            {tracked.length > 5 && (
              <input
                type="search"
                placeholder="Поиск…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
              />
            )}
            <ul className="mt-2 max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {filterProducts(tracked, productSearch).map((p) => {
                const isRefreshing = refreshingIds.has(p.id);
                return (
                  <li
                    key={p.id}
                    className="rounded-md border border-slate-200 p-2 text-sm transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex items-start gap-2">
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded bg-slate-100" />
                      )}
                      <button
                        type="button"
                        onClick={() => void openProductInDashboard(p.id)}
                        className="min-w-0 flex-1 text-left"
                        title="Открыть в Dashboard"
                      >
                        <span className="line-clamp-2 text-slate-900 hover:underline">
                          {p.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {MARKETPLACE_LABELS[p.marketplace]} ·{' '}
                          {formatPrice(p.currentPrice)} · {formatDateTime(p.updatedAt)}
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          title="Открыть на маркетплейсе"
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
          </>
        )}
      </section>
    </div>
  );
}

function filterProducts(products: Product[], q: string): Product[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return products;
  return products.filter(
    (p) =>
      p.title.toLowerCase().includes(needle) ||
      (p.brand?.toLowerCase().includes(needle) ?? false) ||
      (p.sku?.toLowerCase().includes(needle) ?? false),
  );
}

function PopupIcon({
  name,
  spinning = false,
}: {
  name: 'open' | 'refresh' | 'trash' | 'close';
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
  if (name === 'close') {
    return (
      <svg {...common}>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
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
