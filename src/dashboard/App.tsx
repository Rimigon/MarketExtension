import { useCallback, useEffect, useMemo, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { AppNotification, Marketplace, Product } from '@/shared/types';
import { MARKETPLACES } from '@/shared/constants';
import { Sidebar, type ScopeFilter } from './components/Sidebar';
import { ProductList } from './components/ProductList';
import { ProductDetail } from './components/ProductDetail';
import { NotificationsList } from './components/NotificationsList';

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [archivedProducts, setArchivedProducts] = useState<Product[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<Set<Marketplace>>(
    () => new Set(MARKETPLACES),
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [active, archived, notes, unread] = await Promise.all([
      sendRpc('product/list', { archived: false }),
      sendRpc('product/list', { archived: true }),
      sendRpc('notifications/list', { limit: 200 }),
      sendRpc('notifications/unreadCount', {}),
    ]);
    setProducts(active.products);
    setArchivedProducts(archived.products);
    setNotifications(notes.items);
    setUnreadCount(unread.count);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRemove(id: string) {
    await sendRpc('product/remove', { productId: id });
    if (selectedId === id) setSelectedId(null);
    void load();
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
    let pool: Product[] =
      scope === 'archived'
        ? archivedProducts
        : scope === 'favorites'
          ? products.filter((p) => p.isFavorite)
          : products;

    pool = pool.filter((p) => selectedMarketplaces.has(p.marketplace));

    const q = search.trim().toLowerCase();
    if (q) {
      pool = pool.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.brand?.toLowerCase().includes(q) ?? false) ||
          (p.sku?.toLowerCase().includes(q) ?? false),
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

  return (
    <div className="grid h-screen grid-cols-[240px_360px_1fr] bg-slate-50">
      <Sidebar
        scope={scope}
        onScopeChange={(s) => {
          setScope(s);
          setSelectedId(null);
        }}
        selectedMarketplaces={selectedMarketplaces}
        onToggleMarketplace={toggleMarketplace}
        products={allProducts}
        unreadNotifications={unreadCount}
      />

      {loading ? (
        <div className="col-span-2 flex items-center justify-center text-sm text-slate-500">
          Загрузка…
        </div>
      ) : scope === 'notifications' ? (
        <>
          <NotificationsList
            notifications={notifications}
            productsById={productsById}
            selectedProductId={selectedId}
            onSelectProduct={setSelectedId}
            onChange={() => void load()}
          />
          {selectedProduct ? (
            <ProductDetail product={selectedProduct} onRemove={() => handleRemove(selectedProduct.id)} />
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-500">
              Выберите уведомление слева, чтобы открыть товар.
            </div>
          )}
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
            selectedId={selectedId}
            onSelect={setSelectedId}
            search={search}
            onSearchChange={setSearch}
          />
          {selectedProduct ? (
            <ProductDetail product={selectedProduct} onRemove={() => handleRemove(selectedProduct.id)} />
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
