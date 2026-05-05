import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import { formatPrice, formatDateTime } from '@/shared/format';
import { MARKETPLACE_LABELS } from '@/shared/constants';
import type { PriceTier, Product } from '@/shared/types';

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { products } = await sendRpc('product/list', {});
    setProducts(products);
    setLoading(false);
  }

  async function remove(id: string) {
    await sendRpc('product/remove', { productId: id });
    void load();
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">PriceWatch — мои товары</h1>
        <span className="text-sm text-slate-500">{products.length} шт.</span>
      </header>

      {loading ? (
        <p className="mt-8 text-sm text-slate-500">Загрузка…</p>
      ) : products.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">
          Пока ничего не отслеживается. Зайдите на карточку товара Ozon — кнопка «Следить за ценой»
          появится автоматически рядом с ценой.
        </p>
      ) : (
        <div className="mt-6 divide-y divide-slate-200 rounded-md border border-slate-200">
          {products.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              expanded={expanded === p.id}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
              onRemove={() => remove(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  product: Product;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}

function ProductRow({ product, expanded, onToggle, onRemove }: RowProps) {
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-[40px_1fr_120px_120px_140px_60px] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
        ) : (
          <div className="h-10 w-10 rounded bg-slate-100" />
        )}
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-900">{product.title}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">
            {MARKETPLACE_LABELS[product.marketplace]}
            {product.brand ? ` · ${product.brand}` : ''}
            {product.sku ? ` · артикул ${product.sku}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="font-medium text-slate-900">{formatPrice(product.currentPrice)}</div>
          {product.oldPrice && product.oldPrice > (product.currentPrice ?? 0) && (
            <div className="text-xs text-slate-400 line-through">{formatPrice(product.oldPrice)}</div>
          )}
        </div>
        <div className="text-right text-xs text-slate-500">
          {product.discountPct ? `−${product.discountPct}%` : '—'}
        </div>
        <div className="text-right text-xs text-slate-500">{formatDateTime(product.updatedAt)}</div>
        <div className="text-right">
          <span className="text-xs text-slate-400">{expanded ? '▴' : '▾'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3 text-sm">
              <PriceTiersBlock tiers={product.priceTiers} fallback={product} />
              <DetailRow label="Скидка" value={product.discountPct ? `−${product.discountPct}%` : '—'} />
              <DetailRow label="Наличие" value={availabilityLabel(product.availability)} />
              <DetailRow
                label="Рейтинг"
                value={product.rating != null ? product.rating.toFixed(1) : '—'}
              />
              <DetailRow
                label="Отзывов"
                value={product.reviewCount != null ? product.reviewCount.toLocaleString('ru-RU') : '—'}
              />
              <DetailRow label="Артикул" value={product.sku ?? '—'} />
              <div className="pt-2">
                <a
                  href={product.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-500 hover:underline"
                >
                  Открыть страницу товара ↗
                </a>
                <button
                  className="ml-4 text-xs text-rose-600 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                >
                  Удалить
                </button>
              </div>
            </div>

            <div className="space-y-4 text-sm">
              {product.description && (
                <section>
                  <h3 className="text-xs font-semibold uppercase text-slate-500">Описание</h3>
                  <p className="mt-1 whitespace-pre-line text-slate-700">{product.description}</p>
                </section>
              )}

              {product.specs && product.specs.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase text-slate-500">Характеристики</h3>
                  <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                    {product.specs.map((s) => (
                      <SpecRow key={s.name} name={s.name} value={s.value} />
                    ))}
                  </dl>
                </section>
              )}

              {!product.description && (!product.specs || product.specs.length === 0) && (
                <p className="text-xs text-slate-400">
                  Описание и характеристики появятся при следующем заходе на карточку товара.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PriceTiersBlock({ tiers, fallback }: { tiers: PriceTier[] | undefined; fallback: Product }) {
  const list: PriceTier[] = tiers && tiers.length > 0
    ? tiers
    : [
        ...(fallback.currentPrice != null
          ? [{ label: 'Со скидкой', amount: fallback.currentPrice, kind: 'discounted' as const }]
          : []),
        ...(fallback.oldPrice != null
          ? [{ label: 'Без скидки', amount: fallback.oldPrice, kind: 'original' as const }]
          : []),
      ];

  if (list.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-semibold uppercase text-slate-500">Цены</h3>
        <p className="mt-1 text-slate-500">—</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-slate-500">Цены</h3>
      <ul className="mt-1 space-y-1">
        {list.map((t, i) => (
          <li key={`${t.kind}-${i}`} className="grid grid-cols-[160px_1fr] items-baseline gap-2">
            <span className="text-xs text-slate-500">{t.label}</span>
            <span
              className={
                t.kind === 'original'
                  ? 'text-slate-400 line-through'
                  : t.kind === 'discounted'
                    ? 'font-semibold text-emerald-700'
                    : 'text-slate-900'
              }
            >
              {formatPrice(t.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-slate-900">{value}</span>
    </div>
  );
}

function SpecRow({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-slate-500">{name}</dt>
      <dd className="text-slate-900">{value}</dd>
    </>
  );
}

function availabilityLabel(a: string): string {
  switch (a) {
    case 'in_stock':
      return 'В наличии';
    case 'out_of_stock':
      return 'Нет в наличии';
    case 'limited':
      return 'Заканчивается';
    default:
      return '—';
  }
}
