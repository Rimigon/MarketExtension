import { formatPrice } from '@/shared/format';
import { MARKETPLACE_LABELS } from '@/shared/constants';
import type { Product } from '@/shared/types';

interface Props {
  products: Product[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
}

export function ProductList({ products, selectedId, onSelect, search, onSearchChange }: Props) {
  return (
    <div className="flex h-full flex-col border-r border-slate-200">
      <div className="border-b border-slate-200 px-4 py-3">
        <input
          type="search"
          placeholder="Поиск по названию…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {products.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">Ничего не найдено.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {products.map((p) => (
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
                    <div className="truncate text-sm font-medium text-slate-900">{p.title}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {MARKETPLACE_LABELS[p.marketplace]}
                      {p.brand ? ` · ${p.brand}` : ''}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-medium text-slate-900">{formatPrice(p.currentPrice)}</div>
                    {p.discountPct ? (
                      <div className="text-xs text-rose-600">−{p.discountPct}%</div>
                    ) : null}
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
