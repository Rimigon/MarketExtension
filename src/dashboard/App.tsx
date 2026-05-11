import { useCallback, useEffect, useMemo, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { AppNotification, Collection, Marketplace, Product, UserSettings } from '@/shared/types';
import { MARKETPLACES } from '@/shared/constants';
import { resolveThemeId } from '@/shared/themes';
import { Sidebar, type ScopeFilter } from './components/Sidebar';
import {
  ProductList,
  DEFAULT_FILTERS,
  type SortKey,
  type ListFilters,
} from './components/ProductList';
import { ProductDetail } from './components/ProductDetail';
import { NotificationsList } from './components/NotificationsList';
import { NotificationDetail } from './components/NotificationDetail';
import { StatsPage } from './components/StatsPage';
import { ParserHealthPage } from './components/ParserHealthPage';
import { HelpPage } from './components/HelpPage';
import { SettingsPage } from './components/SettingsPage';
import { BulkRefreshToast, type BulkRefreshSummary } from './components/BulkRefreshToast';
export type { BulkRefreshSummary } from './components/BulkRefreshToast';

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [archivedProducts, setArchivedProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [trends, setTrends] = useState<
    Record<string, { abs: number; pct: number; firstPrice: number; firstAt: number } | null>
  >({});
  const [loading, setLoading] = useState(true);
  const initialHash = typeof window !== 'undefined' ? window.location.hash : '';
  const [scope, setScope] = useState<ScopeFilter>(() => {
    if (initialHash === '#settings') return { kind: 'settings' };
    if (initialHash.startsWith('#notifications')) return { kind: 'notifications' };
    return { kind: 'all' };
  });
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(() => {
    const m = initialHash.match(/^#notifications\/([^/?&]+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  });
  const initialProductIdFromHash = (() => {
    const m = initialHash.match(/^#product\/([^/?&]+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  })();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(initialProductIdFromHash);
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<Set<Marketplace>>(
    () => new Set(MARKETPLACES),
  );
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(() => new Set());
  const [bulkRefreshProgress, setBulkRefreshProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [bulkSummary, setBulkSummary] = useState<BulkRefreshSummary | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [schedulerBump, setSchedulerBump] = useState(0);
  const bumpScheduler = useCallback(() => setSchedulerBump((v) => v + 1), []);

  // Only the *first* load flips `loading` to true; subsequent refreshes (after
  // a settings save, a product add, etc.) keep the current UI mounted and just
  // overwrite the data in place. Otherwise re-mounting the SettingsPage on every
  // tiny patch resets local state — the user perceives it as «checkbox won't
  // turn off» / «scrolled back to top».
  const load = useCallback(async () => {
    const [active, archived, notes, unread, cols, tr, st] = await Promise.all([
      sendRpc('product/list', { archived: false }),
      sendRpc('product/list', { archived: true }),
      sendRpc('notifications/list', { limit: 200 }),
      sendRpc('notifications/unreadCount', {}),
      sendRpc('collections/list', {}),
      sendRpc('priceTrends/list', {}),
      sendRpc('settings/get', {}),
    ]);
    setProducts(active.products);
    setArchivedProducts(archived.products);
    setNotifications(notes.items);
    setUnreadCount(unread.count);
    setCollections(cols.collections);
    setTrends(tr.trends);
    setSettings(st.settings);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Apply the theme picked in settings to <html data-theme="...">. Re-runs
  // whenever settings change (theme picker triggers a settings/update which
  // calls load(), which sets a new settings object).
  useEffect(() => {
    const themeId = settings?.theme ?? 'auto';
    const apply = () => {
      document.documentElement.setAttribute('data-theme', resolveThemeId(themeId));
    };
    apply();
    if (themeId === 'auto' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => apply();
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [settings?.theme]);

  // When the dashboard opens (or is navigated) to a specific notification via
  // hash, mark it read once the list is loaded.
  useEffect(() => {
    if (selectedNotificationId == null || loading) return;
    const note = notifications.find((n) => n.id === selectedNotificationId);
    if (!note || note.readAt != null) return;
    void sendRpc('notifications/markRead', { id: note.id }).then(() => void load());
  }, [selectedNotificationId, loading, notifications, load]);

  // Listen for hash changes — chrome.tabs.update from a notification click can
  // navigate the existing dashboard tab to a new hash. Re-route the UI when it does.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const apply = () => {
      const h = window.location.hash;
      if (h === '#settings') {
        setScope({ kind: 'settings' });
        setSelectedNotificationId(null);
      } else if (h.startsWith('#notifications')) {
        setScope({ kind: 'notifications' });
        const m = h.match(/^#notifications\/([^/?&]+)$/);
        setSelectedNotificationId(m ? decodeURIComponent(m[1]) : null);
      } else if (h.startsWith('#product/')) {
        // Popup → "open product in dashboard" navigates the existing tab to
        // #product/<id>; surface that product in the All Products view.
        const m = h.match(/^#product\/([^/?&]+)$/);
        if (m) {
          setScope({ kind: 'all' });
          setSelectedId(decodeURIComponent(m[1]));
        }
      }
    };
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  // On mount: pull any scheduler summary that completed while dashboard was closed.
  useEffect(() => {
    let cancelled = false;
    void sendRpc('scheduler/lastSummary', {}).then((resp) => {
      if (cancelled) return;
      if (resp.summary) setBulkSummary(resp.summary);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for the scheduler-completed broadcast from the background SW.
  // Surface the same toast we use for manual «Обновить все», and refresh data.
  useEffect(() => {
    const listener = (msg: unknown) => {
      if (
        !msg ||
        typeof msg !== 'object' ||
        (msg as { type?: string }).type !== 'pricewatch:scheduledRefreshDone'
      ) {
        return;
      }
      const summary = (msg as { summary?: BulkRefreshSummary }).summary;
      if (summary) setBulkSummary(summary);
      void load();
      bumpScheduler();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [load]);

  async function handleRemove(id: string) {
    await sendRpc('product/remove', { productId: id });
    if (selectedId === id) setSelectedId(null);
    void load();
  }

  async function handleRefreshProduct(id: string) {
    setRefreshingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      await sendRpc('product/refresh', { productId: id });
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      void load();
      bumpScheduler();
    }
  }

  async function handleRefreshAll() {
    // Refresh whatever is currently visible (matches the user's filters/scope).
    // The background's single-flight queue serializes calls, so even though we
    // could fire them in parallel, a sequential await gives accurate progress.
    const targets = visibleProducts.map((p) => ({
      id: p.id,
      title: p.title,
      before: p.currentPrice,
    }));
    if (targets.length === 0) return;
    setBulkRefreshProgress({ done: 0, total: targets.length });
    setBulkSummary(null);
    const changes: BulkRefreshSummary['changes'] = [];
    let succeeded = 0;
    let failed = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]!;
        try {
          const resp = await sendRpc('product/refresh', { productId: t.id });
          if ('ok' in resp && resp.ok) {
            succeeded++;
            const after = resp.product.currentPrice;
            if (t.before != null && after != null && after !== t.before) {
              changes.push({ id: t.id, title: t.title, before: t.before, after });
            }
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
        setBulkRefreshProgress({ done: i + 1, total: targets.length });
      }
    } finally {
      setBulkRefreshProgress(null);
      setBulkSummary({ total: targets.length, succeeded, failed, changes });
      void load();
      bumpScheduler();
    }
  }

  const allProducts = useMemo(
    () => [...products, ...archivedProducts],
    [products, archivedProducts],
  );

  const productsById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of allProducts) m.set(p.id, p);
    return m;
  }, [allProducts]);

  const visibleProducts = useMemo(() => {
    let pool: Product[];
    if (scope.kind === 'archived') pool = archivedProducts;
    else if (scope.kind === 'favorites') pool = products.filter((p) => p.isFavorite);
    else if (scope.kind === 'collection')
      pool = products.filter((p) => p.collectionIds.includes(scope.id));
    else pool = products;

    pool = pool.filter((p) => selectedMarketplaces.has(p.marketplace));

    const q = search.trim().toLowerCase();
    if (q) {
      pool = pool.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.brand?.toLowerCase().includes(q) ?? false) ||
          (p.sku?.toLowerCase().includes(q) ?? false) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return pool;
  }, [scope, products, archivedProducts, selectedMarketplaces, search]);

  const selectedProduct = useMemo(
    () => (selectedId ? productsById.get(selectedId) ?? null : null),
    [productsById, selectedId],
  );

  function toggleMarketplace(m: Marketplace) {
    setSelectedMarketplaces((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      if (next.size === 0) MARKETPLACES.forEach((x) => next.add(x));
      return next;
    });
  }

  const displayMode = settings?.displayMode ?? 'list';
  // Fixed list-column width across all display modes — switching list/cards/grid
  // should not resize neighbouring panes. 420px is comfortable for cards/grid
  // (two columns of thumbnails fit) and still readable for the dense list view.
  const LIST_COLUMN_PX = 420;

  return (
    <div
      className="grid h-screen w-full overflow-hidden bg-slate-50"
      style={{ gridTemplateColumns: `240px ${LIST_COLUMN_PX}px minmax(0, 1fr)` }}
    >
      <BulkRefreshToast summary={bulkSummary} onClose={() => setBulkSummary(null)} />
      <Sidebar
        scope={scope}
        onScopeChange={(s) => {
          setScope(s);
          if (s.kind !== 'stats') setSelectedId(null);
        }}
        selectedMarketplaces={selectedMarketplaces}
        onToggleMarketplace={toggleMarketplace}
        products={allProducts}
        unreadNotifications={unreadCount}
        collections={collections}
        onCollectionsChange={() => void load()}
      />

      {loading ? (
        <div className="col-span-2 flex items-center justify-center text-sm text-slate-500">
          Загрузка…
        </div>
      ) : scope.kind === 'stats' ? (
        <StatsPage
          onSelectProduct={(id) => {
            setScope({ kind: 'all' });
            setSelectedId(id);
          }}
          onOpenHealth={() => setScope({ kind: 'health' })}
        />
      ) : scope.kind === 'health' ? (
        <ParserHealthPage />
      ) : scope.kind === 'help' ? (
        <HelpPage />
      ) : scope.kind === 'settings' ? (
        <SettingsPage
          onSettingsSaved={() => {
            void load();
            bumpScheduler();
          }}
        />
      ) : scope.kind === 'notifications' ? (
        <>
          <NotificationsList
            notifications={notifications}
            productsById={productsById}
            selectedNotificationId={selectedNotificationId}
            onSelectNotification={(noteId, productId) => {
              setSelectedNotificationId(noteId);
              if (productId && productId !== '_global') setSelectedId(productId);
            }}
            onChange={() => void load()}
          />
          {(() => {
            const selectedNote =
              selectedNotificationId != null
                ? notifications.find((n) => n.id === selectedNotificationId) ?? null
                : null;
            if (selectedNote) {
              const noteProduct =
                selectedNote.productId !== '_global'
                  ? productsById.get(selectedNote.productId) ?? null
                  : null;
              return (
                <NotificationDetail
                  notification={selectedNote}
                  product={noteProduct}
                  onOpenProduct={(id) => {
                    setScope({ kind: 'all' });
                    setSelectedId(id);
                  }}
                />
              );
            }
            return (
              <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-500">
                Выберите уведомление слева — справа откроется подробное описание:
                что сработало, как изменилась цена и при ошибке — в чём проблема.
              </div>
            );
          })()}
        </>
      ) : allProducts.length === 0 ? (
        <div className="col-span-2 flex items-center justify-center px-8 text-center text-sm text-slate-500">
          Пока ничего не отслеживается. Зайдите на карточку товара Ozon / Wildberries / Я.Маркет —
          кнопка «Следить за ценой» появится автоматически рядом с ценой.
        </div>
      ) : (
        <>
          <ProductList
            products={visibleProducts}
            trends={trends}
            selectedId={selectedId}
            onSelect={setSelectedId}
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            filters={filters}
            onFiltersChange={setFilters}
            refreshingIds={refreshingIds}
            onRefreshProduct={handleRefreshProduct}
            onRefreshAll={handleRefreshAll}
            bulkRefreshProgress={bulkRefreshProgress}
            onRemoveProduct={handleRemove}
            marketplaceColorCoding={settings?.marketplaceColorCoding ?? true}
            displayMode={displayMode}
            onDisplayModeChange={(m) => {
              // Persist immediately — feels weird when the toggle reverts on
              // refresh.
              void sendRpc('settings/update', { patch: { displayMode: m } }).then(() =>
                load(),
              );
            }}
            schedulerBump={schedulerBump}
          />
          {selectedProduct ? (
            <ProductDetail
              product={selectedProduct}
              collections={collections}
              onRemove={() => handleRemove(selectedProduct.id)}
              onChanged={() => void load()}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-500">
              Выберите товар слева, чтобы увидеть детали и график цены.
            </div>
          )}
        </>
      )}
    </div>
  );
}
