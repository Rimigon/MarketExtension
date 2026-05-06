import type { Marketplace, Product } from '@/shared/types';
import { MARKETPLACE_LABELS, MARKETPLACES } from '@/shared/constants';

export type ScopeFilter = 'all' | 'favorites' | 'archived' | 'notifications';

interface Props {
  scope: ScopeFilter;
  onScopeChange: (s: ScopeFilter) => void;
  selectedMarketplaces: Set<Marketplace>;
  onToggleMarketplace: (m: Marketplace) => void;
  products: Product[];
  unreadNotifications: number;
}

export function Sidebar({
  scope,
  onScopeChange,
  selectedMarketplaces,
  onToggleMarketplace,
  products,
  unreadNotifications,
}: Props) {
  const counts = {
    all: products.filter((p) => !p.isArchived).length,
    favorites: products.filter((p) => p.isFavorite && !p.isArchived).length,
    archived: products.filter((p) => p.isArchived).length,
  };

  const mpCounts = MARKETPLACES.reduce<Record<Marketplace, number>>(
    (acc, m) => {
      acc[m] = products.filter((p) => p.marketplace === m && !p.isArchived).length;
      return acc;
    },
    { ozon: 0, wildberries: 0, 'yandex-market': 0 },
  );

  return (
    <aside className="flex h-full flex-col border-r border-slate-200 bg-slate-50/40 px-4 py-6">
      <div className="px-2 text-lg font-semibold text-slate-900">PriceWatch</div>
      <nav className="mt-6 space-y-0.5 text-sm">
        <ScopeButton
          label="Все товары"
          count={counts.all}
          active={scope === 'all'}
          onClick={() => onScopeChange('all')}
        />
        <ScopeButton
          label="Избранное"
          count={counts.favorites}
          active={scope === 'favorites'}
          onClick={() => onScopeChange('favorites')}
        />
        <ScopeButton
          label="Архив"
          count={counts.archived}
          active={scope === 'archived'}
          onClick={() => onScopeChange('archived')}
        />
        <ScopeButton
          label="Уведомления"
          count={unreadNotifications}
          active={scope === 'notifications'}
          onClick={() => onScopeChange('notifications')}
          countTone={unreadNotifications > 0 ? 'badge' : 'neutral'}
        />
      </nav>

      <div className="mt-8 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Маркетплейс
      </div>
      <ul className="mt-2 space-y-0.5 text-sm">
        {MARKETPLACES.map((m) => {
          const checked = selectedMarketplaces.has(m);
          return (
            <li key={m}>
              <button
                type="button"
                onClick={() => onToggleMarketplace(m)}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${
                  checked ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded border ${
                      checked ? 'border-brand-500 bg-brand-500' : 'border-slate-300 bg-white'
                    }`}
                    aria-hidden
                  >
                    {checked && (
                      <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 text-white">
                        <path d="M2.5 6.5L5 9l4.5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {MARKETPLACE_LABELS[m]}
                </span>
                <span className="text-xs text-slate-400">{mpCounts[m]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function ScopeButton({
  label,
  count,
  active,
  onClick,
  countTone = 'neutral',
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  countTone?: 'neutral' | 'badge';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${
        active
          ? 'bg-brand-50 font-medium text-brand-700'
          : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      <span>{label}</span>
      {countTone === 'badge' && count > 0 ? (
        <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
          {count}
        </span>
      ) : (
        <span className="text-xs text-slate-400">{count}</span>
      )}
    </button>
  );
}
