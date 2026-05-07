import { useMemo, useState } from 'react';
import { formatPrice, formatPercent } from '@/shared/format';
import { MARKETPLACE_ACCENT, MARKETPLACE_LABELS } from '@/shared/constants';
import type { Product, ProductDisplayMode } from '@/shared/types';
import { SchedulerHint } from './SchedulerHint';

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
  refreshingIds: Set<string>;
  onRefreshProduct: (id: string) => void;
  onRefreshAll: () => void;
  bulkRefreshProgress: { done: number; total: number } | null;
  onRemoveProduct: (id: string) => void;
  marketplaceColorCoding: boolean;
  displayMode: ProductDisplayMode;
  onDisplayModeChange: (m: ProductDisplayMode) => void;
  /** Increments after each refresh — SchedulerHint re-polls when it changes. */
  schedulerBump: number;
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
  refreshingIds,
  onRefreshProduct,
  onRefreshAll,
  bulkRefreshProgress,
  onRemoveProduct,
  marketplaceColorCoding,
  displayMode,
  onDisplayModeChange,
  schedulerBump,
}: Props) {
  const filtered = useMemo(() => applyFilters(products, filters), [products, filters]);
  const sorted = useMemo(() => applySort(filtered, sort), [filtered, sort]);

  const filtersActive = isFiltersActive(filters);
  const bulkActive = bulkRefreshProgress != null;
  const [filtersOpen, setFiltersOpen] = useState(false);

  const itemProps = {
    selectedId,
    refreshingIds,
    bulkActive,
    trends,
    marketplaceColorCoding,
    onSelect,
    onRefreshProduct,
    onRemoveProduct,
  };

  return (
    <div className="flex h-full flex-col border-r border-slate-200 bg-slate-50">
      {/* Header zone — each tier gets its own row so controls have breathing
          room and never collapse to a 10-pixel-wide pill. */}
      <div className="border-b border-slate-200 bg-white px-4 pt-4 pb-3">
        {/* Tier 1 — scheduler status pill + bulk refresh action. */}
        <div className="flex items-center gap-2">
          <SchedulerHint bump={schedulerBump} variant="pill" />
          <div className="flex-1" />
          <button
            type="button"
            onClick={onRefreshAll}
            disabled={bulkActive || sorted.length === 0}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            title={`Обновить все (${sorted.length})`}
          >
            <RefreshIcon spinning={bulkActive} />
            {bulkActive
              ? `${bulkRefreshProgress!.done}/${bulkRefreshProgress!.total}`
              : 'Обновить все'}
          </button>
        </div>

        {/* Tier 2 — search input gets the full width. */}
        <input
          type="search"
          placeholder="Поиск по названию, бренду, артикулу…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="mt-3 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
        />

        {/* Tier 3 — display mode + sort + filters toggle. Each control has a
            comfortable hit area so they never shrink to 10px. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DisplayModeSwitch value={displayMode} onChange={onDisplayModeChange} />
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="text-slate-500">Сортировка:</span>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortKey)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
            >
              <option value="updated">Обновлено</option>
              <option value="price-asc">Цена ↑</option>
              <option value="price-desc">Цена ↓</option>
              <option value="discount">Скидка</option>
              <option value="title">Название</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className={`ml-auto inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs transition ${
              filtersActive
                ? 'border-brand-300 bg-brand-50 text-brand-700'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            Фильтры{filtersActive ? ' •' : ''}
            <span aria-hidden className={`transition ${filtersOpen ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </button>
        </div>

        {/* Tier 4 — full-width filter panel that expands inline (not as a
            tooltip) so each input has room. */}
        {filtersOpen && (
          <div className="mt-3">
            <FilterPanel filters={filters} onChange={onFiltersChange} />
          </div>
        )}

        {/* Tier 5 — quiet count line. */}
        <div className="mt-2 text-[11px] text-slate-400">
          Найдено: {sorted.length} из {products.length}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50">
        {sorted.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">Ничего не найдено.</p>
        ) : displayMode === 'grid' ? (
          <ul className="grid grid-cols-2 gap-2 p-3">
            {sorted.map((p) => (
              <GridItem key={p.id} product={p} {...itemProps} />
            ))}
          </ul>
        ) : displayMode === 'cards' ? (
          <ul className="space-y-2 p-3">
            {sorted.map((p) => (
              <CardItem key={p.id} product={p} {...itemProps} />
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {sorted.map((p) => (
              <ListItem key={p.id} product={p} {...itemProps} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ItemBaseProps {
  product: Product;
  selectedId: string | null;
  refreshingIds: Set<string>;
  bulkActive: boolean;
  trends: Record<string, Trend>;
  marketplaceColorCoding: boolean;
  onSelect: (id: string) => void;
  onRefreshProduct: (id: string) => void;
  onRemoveProduct: (id: string) => void;
}

function ListItem({
  product: p,
  selectedId,
  refreshingIds,
  bulkActive,
  trends,
  marketplaceColorCoding,
  onSelect,
  onRefreshProduct,
  onRemoveProduct,
}: ItemBaseProps) {
  const isRefreshing = refreshingIds.has(p.id);
  const accent = MARKETPLACE_ACCENT[p.marketplace];
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onSelect(p.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(p.id);
        }
      }}
      style={
        marketplaceColorCoding
          ? { boxShadow: `inset 4px 0 0 ${accent.stripe}` }
          : undefined
      }
      className={`cv-list-row group relative grid w-full cursor-pointer grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
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
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
          {marketplaceColorCoding ? (
            <span
              style={{ background: accent.bg, color: accent.stripe }}
              className="inline-flex h-4 items-center rounded px-1.5 text-[10px] font-medium"
            >
              {MARKETPLACE_LABELS[p.marketplace]}
            </span>
          ) : (
            <span>{MARKETPLACE_LABELS[p.marketplace]}</span>
          )}
          {p.brand && <span className="truncate">· {p.brand}</span>}
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
      <div className="flex items-center gap-2 text-right text-sm">
        <div>
          <div className="font-medium text-slate-900">{formatPrice(p.currentPrice)}</div>
          <TrendChip trend={trends[p.id] ?? null} />
          {p.goal?.targetPrice != null && (
            <div className="mt-0.5 text-[10px] text-slate-500">
              цель {formatPrice(p.goal.targetPrice)}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Открыть на маркетплейсе"
            className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            <OpenIcon />
          </a>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRefreshProduct(p.id);
            }}
            disabled={isRefreshing || bulkActive}
            title="Обновить цену"
            className={`flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 ${
              isRefreshing ? 'text-brand-500' : ''
            }`}
          >
            <RefreshIcon spinning={isRefreshing} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Удалить «${p.title}» из отслеживания?`)) {
                onRemoveProduct(p.id);
              }
            }}
            title="Удалить"
            className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </li>
  );
}

function CardItem({
  product: p,
  selectedId,
  refreshingIds,
  bulkActive,
  trends,
  marketplaceColorCoding,
  onSelect,
  onRefreshProduct,
  onRemoveProduct,
}: ItemBaseProps) {
  const isRefreshing = refreshingIds.has(p.id);
  const accent = MARKETPLACE_ACCENT[p.marketplace];
  const selected = selectedId === p.id;
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onSelect(p.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(p.id);
        }
      }}
      style={
        marketplaceColorCoding
          ? { boxShadow: `inset 4px 0 0 ${accent.stripe}` }
          : undefined
      }
      className={`cv-card flex cursor-pointer gap-3 rounded-md border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        selected
          ? 'border-brand-300 bg-brand-50'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      {p.imageUrl ? (
        <img src={p.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-20 w-20 shrink-0 rounded bg-slate-100" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              {p.isFavorite && <span className="text-amber-500">★</span>}
              <span className="line-clamp-2 text-sm font-medium text-slate-900">
                {p.title}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              {marketplaceColorCoding ? (
                <span
                  style={{ background: accent.bg, color: accent.stripe }}
                  className="inline-flex h-4 items-center rounded px-1.5 text-[10px] font-medium"
                >
                  {MARKETPLACE_LABELS[p.marketplace]}
                </span>
              ) : (
                <span>{MARKETPLACE_LABELS[p.marketplace]}</span>
              )}
              {p.brand && <span className="truncate">· {p.brand}</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-base font-semibold text-slate-900">
              {formatPrice(p.currentPrice)}
            </div>
            <TrendChip trend={trends[p.id] ?? null} />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          {p.goal?.targetPrice != null ? (
            <span className="text-[11px] text-slate-500">
              цель {formatPrice(p.goal.targetPrice)}
            </span>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-0.5">
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Открыть на маркетплейсе"
              className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <OpenIcon />
            </a>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRefreshProduct(p.id);
              }}
              disabled={isRefreshing || bulkActive}
              title="Обновить цену"
              className={`flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 ${
                isRefreshing ? 'text-brand-500' : ''
              }`}
            >
              <RefreshIcon spinning={isRefreshing} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Удалить «${p.title}» из отслеживания?`)) {
                  onRemoveProduct(p.id);
                }
              }}
              title="Удалить"
              className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function GridItem({
  product: p,
  selectedId,
  trends,
  marketplaceColorCoding,
  onSelect,
}: ItemBaseProps) {
  const accent = MARKETPLACE_ACCENT[p.marketplace];
  const selected = selectedId === p.id;
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onSelect(p.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(p.id);
        }
      }}
      style={
        marketplaceColorCoding
          ? { boxShadow: `inset 0 -3px 0 ${accent.stripe}` }
          : undefined
      }
      className={`cv-grid flex cursor-pointer flex-col overflow-hidden rounded-md border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        selected
          ? 'border-brand-300 bg-brand-50'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      {p.imageUrl ? (
        <img
          src={p.imageUrl}
          alt=""
          className="aspect-square w-full object-cover"
        />
      ) : (
        <div className="aspect-square w-full bg-slate-100" />
      )}
      <div className="space-y-1 p-2">
        <div className="line-clamp-2 text-xs font-medium text-slate-900">{p.title}</div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-slate-900">
            {formatPrice(p.currentPrice)}
          </span>
          <TrendChip trend={trends[p.id] ?? null} />
        </div>
      </div>
    </li>
  );
}

function DisplayModeSwitch({
  value,
  onChange,
}: {
  value: ProductDisplayMode;
  onChange: (m: ProductDisplayMode) => void;
}) {
  const opts: { v: ProductDisplayMode; label: string; icon: 'list' | 'cards' | 'grid' }[] = [
    { v: 'list', label: 'Список', icon: 'list' },
    { v: 'cards', label: 'Каталог', icon: 'cards' },
    { v: 'grid', label: 'Сетка', icon: 'grid' },
  ];
  return (
    <div
      className="inline-flex overflow-hidden rounded border border-slate-200"
      role="group"
      aria-label="Режим отображения"
    >
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            title={o.label}
            aria-pressed={active}
            className={`flex items-center gap-1 px-2 py-1 text-xs ${
              active
                ? 'bg-brand-500 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <DisplayModeIcon kind={o.icon} />
          </button>
        );
      })}
    </div>
  );
}

function DisplayModeIcon({ kind }: { kind: 'list' | 'cards' | 'grid' }) {
  if (kind === 'list') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    );
  }
  if (kind === 'cards') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="6" rx="1" />
        <rect x="3" y="14" width="18" height="6" rx="1" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
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

function OpenIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? 'animate-spin' : ''}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
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
