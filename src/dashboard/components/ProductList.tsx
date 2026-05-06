import { useMemo } from 'react';
import { formatPrice, formatPercent } from '@/shared/format';
import { MARKETPLACE_LABELS } from '@/shared/constants';
import type { Product } from '@/shared/types';

export type Trend = { abs: number; pct: number; firstPrice: number; firstAt: number } | null;

export type SortKey = 'updated' | 'price-asc' | 'price-desc' | 'discount' | 'title';

export interface ListFilters {
  minPrice: number | null;
  maxPrice: number | null;
  minDiscount: number | null;
  inStockOnly: boolean;
  withGoalOnly: boolean;
}

export const DEFAULT_FILTERS: ListFilters = {
  minPrice: null,
  maxPrice: null,
  minDiscount: null,
  inStockOnly: false,
  withGoalOnly: false,
};

interface Props {
  products: Product[];
  trends: Record<string, Trend>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  filters: ListFilters;
  onFiltersChange: (f: ListFilters) => void;
}

export function ProductList({
  products,
  trends,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  sort,
  onSortChange,
  filters,
  onFiltersChange,
}: Props) {
  const filtered = useMemo(() => applyFilters(products, filters), [products, filters]);
  const sorted = useMemo(() => applySort(filtered, sort), [filtered, sort]);

  const filtersActive = isFiltersActive(filters);

  return (
    <div className="flex h-full flex-col border-r border-slate-200">
      <div className="space-y-2 border-b border-slate-200 px-4 py-3">
        <input
          type="search"
          placeholder="Поиск по названию, бренду, артикулу…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
        />

        <div className="flex items-center gap-2 text-xs text-slate-600">
          <label className="flex items-center gap-1">
            <span className="text-slate-500">Сорт.:</span>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortKey)}
              className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs focus:border-brand-500 focus:outline-none"
            >
              <option value="updated">Обновлено</option>
              <option value="price-asc">Цена ↑</option>
              <option value="price-desc">Цена ↓</option>
              <option value="discount">Скидка</option>
              <option value="title">Название</option>
            </select>
          </label>

          <details className="ml-auto">
            <summary
              className={`cursor-pointer select-none rounded px-2 py-1 ${
                filtersActive ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-100'
              }`}
            >
              Фильтры{filtersActive ? ' •' : ''}
            </summary>
            <FilterPanel filters={filters} onChange={onFiltersChange} />
          </details>
        </div>
      </div>

      <div className="px-4 py-1 text-xs text-slate-400">
        Найдено: {sorted.length} из {products.length}
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">Ничего не найдено.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sorted.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className={`grid w-full grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-3 text-left ${
                    selectedId === p.id ? 'bg-brand-50' : 'hover:bg-slate-50'
                  }`}
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded bg-slate-100" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      {p.isFavorite && <span className="text-amber-500">★</span>}
                      <span className="truncate text-sm font-medium text-slate-900">{p.title}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {MARKETPLACE_LABELS[p.marketplace]}
                      {p.brand ? ` · ${p.brand}` : ''}
                    </div>
                    {p.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-medium text-slate-900">{formatPrice(p.currentPrice)}</div>
                    <TrendChip trend={trends[p.id] ?? null} />
                    {p.goal?.targetPrice != null && (
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        цель {formatPrice(p.goal.targetPrice)}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilterPanel({
  filters,
  onChange,
}: {
  filters: ListFilters;
  onChange: (f: ListFilters) => void;
}) {
  function set<K extends keyof ListFilters>(key: K, value: ListFilters[K]) {
    onChange({ ...filters, [key]: value });
  }
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 rounded border border-slate-200 bg-white p-3 text-xs">
      <label className="col-span-2 text-slate-500">Цена, ₽</label>
      <input
        type="number"
        placeholder="от"
        value={filters.minPrice ?? ''}
        onChange={(e) => set('minPrice', e.target.value === '' ? null : Number(e.target.value))}
        className="rounded border border-slate-200 px-2 py-1"
      />
      <input
        type="number"
        placeholder="до"
        value={filters.maxPrice ?? ''}
        onChange={(e) => set('maxPrice', e.target.value === '' ? null : Number(e.target.value))}
        className="rounded border border-slate-200 px-2 py-1"
      />

      <label className="col-span-2 mt-1 text-slate-500">Скидка ≥, %</label>
      <input
        type="number"
        placeholder="0"
        value={filters.minDiscount ?? ''}
        onChange={(e) => set('minDiscount', e.target.value === '' ? null : Number(e.target.value))}
        className="col-span-2 rounded border border-slate-200 px-2 py-1"
      />

      <label className="col-span-2 mt-1 flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.inStockOnly}
          onChange={(e) => set('inStockOnly', e.target.checked)}
        />
        Только в наличии
      </label>
      <label className="col-span-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.withGoalOnly}
          onChange={(e) => set('withGoalOnly', e.target.checked)}
        />
        Только с целевой ценой
      </label>

      <button
        type="button"
        onClick={() => onChange(DEFAULT_FILTERS)}
        className="col-span-2 mt-1 rounded border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
      >
        Сбросить фильтры
      </button>
    </div>
  );
}

export function isFiltersActive(f: ListFilters): boolean {
  return (
    f.minPrice != null ||
    f.maxPrice != null ||
    f.minDiscount != null ||
    f.inStockOnly ||
    f.withGoalOnly
  );
}

export function applyFilters(products: Product[], f: ListFilters): Product[] {
  return products.filter((p) => {
    if (f.minPrice != null && (p.currentPrice == null || p.currentPrice < f.minPrice)) return false;
    if (f.maxPrice != null && (p.currentPrice == null || p.currentPrice > f.maxPrice)) return false;
    if (f.minDiscount != null && (p.discountPct == null || p.discountPct < f.minDiscount)) return false;
    if (f.inStockOnly && p.availability !== 'in_stock' && p.availability !== 'limited') return false;
    if (f.withGoalOnly && p.goal?.targetPrice == null) return false;
    return true;
  });
}

function TrendChip({ trend }: { trend: Trend }) {
  if (!trend || trend.pct === 0) return null;
  // По соглашению: цена упала (pct < 0) — зелёный (хорошо), цена выросла (pct > 0) — красный.
  const isDrop = trend.pct < 0;
  const sign = isDrop ? '−' : '+';
  const tone = isDrop ? 'text-emerald-600' : 'text-rose-600';
  return (
    <div className={`text-xs ${tone}`}>
      {sign}
      {formatPercent(Math.abs(trend.pct))}
    </div>
  );
}

export function applySort(products: Product[], sort: SortKey): Product[] {
  const arr = [...products];
  switch (sort) {
    case 'updated':
      return arr.sort((a, b) => b.updatedAt - a.updatedAt);
    case 'price-asc':
      return arr.sort((a, b) => (a.currentPrice ?? Infinity) - (b.currentPrice ?? Infinity));
    case 'price-desc':
      return arr.sort((a, b) => (b.currentPrice ?? -Infinity) - (a.currentPrice ?? -Infinity));
    case 'discount':
      return arr.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0));
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }
}
