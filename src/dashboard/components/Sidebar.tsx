import { useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { Collection, Marketplace, Product } from '@/shared/types';
import { MARKETPLACE_LABELS, MARKETPLACES } from '@/shared/constants';
import { t } from '@/shared/i18n';
import { Logo } from './Logo';

export type ScopeFilter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'archived' }
  | { kind: 'notifications' }
  | { kind: 'stats' }
  | { kind: 'health' }
  | { kind: 'help' }
  | { kind: 'settings' }
  | { kind: 'collection'; id: string };

interface Props {
  scope: ScopeFilter;
  onScopeChange: (s: ScopeFilter) => void;
  selectedMarketplaces: Set<Marketplace>;
  onToggleMarketplace: (m: Marketplace) => void;
  products: Product[];
  unreadNotifications: number;
  collections: Collection[];
  onCollectionsChange: () => void;
}

export function Sidebar({
  scope,
  onScopeChange,
  selectedMarketplaces,
  onToggleMarketplace,
  products,
  unreadNotifications,
  collections,
  onCollectionsChange,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');

  const counts = {
    all: products.filter((p) => !p.isArchived).length,
    favorites: products.filter((p) => p.isFavorite && !p.isArchived).length,
    archived: products.filter((p) => p.isArchived).length,
  };

  const collectionCounts = collections.reduce<Record<string, number>>((acc, c) => {
    acc[c.id] = products.filter(
      (p) => !p.isArchived && p.collectionIds.includes(c.id),
    ).length;
    return acc;
  }, {});

  const mpCounts = MARKETPLACES.reduce<Record<Marketplace, number>>(
    (acc, m) => {
      acc[m] = products.filter((p) => p.marketplace === m && !p.isArchived).length;
      return acc;
    },
    { ozon: 0, wildberries: 0, 'yandex-market': 0 },
  );

  async function addCollection() {
    const name = newName.trim();
    if (!name) return;
    await sendRpc('collections/upsert', { collection: { name } });
    setNewName('');
    onCollectionsChange();
  }

  async function removeCollection(id: string) {
    await sendRpc('collections/remove', { id });
    if (scope.kind === 'collection' && scope.id === id) onScopeChange({ kind: 'all' });
    onCollectionsChange();
  }

  return (
    <aside className="flex h-full flex-col overflow-y-auto overscroll-contain border-r border-slate-200 bg-slate-50 px-4 py-6">
      <div className="flex items-center justify-between px-2 text-lg text-slate-900">
        <Logo iconSize={22} />
      </div>

      <nav className="mt-6 space-y-0.5 text-sm">
        <ScopeButton
          label={t('sidebar.allProducts')}
          count={counts.all}
          active={scope.kind === 'all'}
          onClick={() => onScopeChange({ kind: 'all' })}
        />
        <ScopeButton
          label={t('sidebar.favorites')}
          count={counts.favorites}
          active={scope.kind === 'favorites'}
          onClick={() => onScopeChange({ kind: 'favorites' })}
        />
        <ScopeButton
          label={t('sidebar.archived')}
          count={counts.archived}
          active={scope.kind === 'archived'}
          onClick={() => onScopeChange({ kind: 'archived' })}
        />
        <ScopeButton
          label={t('sidebar.stats')}
          active={scope.kind === 'stats'}
          onClick={() => onScopeChange({ kind: 'stats' })}
        />
        <ScopeButton
          label="Здоровье парсеров"
          active={scope.kind === 'health'}
          onClick={() => onScopeChange({ kind: 'health' })}
        />
        <ScopeButton
          label={t('sidebar.notifications')}
          count={unreadNotifications}
          active={scope.kind === 'notifications'}
          onClick={() => onScopeChange({ kind: 'notifications' })}
          countTone={unreadNotifications > 0 ? 'badge' : 'neutral'}
        />
        <ScopeButton
          label={t('sidebar.settings')}
          active={scope.kind === 'settings'}
          onClick={() => onScopeChange({ kind: 'settings' })}
        />
        <ScopeButton
          label="Помощь"
          active={scope.kind === 'help'}
          onClick={() => onScopeChange({ kind: 'help' })}
        />
      </nav>

      <div className="mt-8 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>{t('sidebar.collections')}</span>
        <button
          type="button"
          className="text-[10px] font-normal normal-case text-brand-500 hover:underline"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? t('sidebar.collectionsDone') : t('sidebar.collectionsEdit')}
        </button>
      </div>
      <ul className="mt-2 space-y-0.5 text-sm">
        {collections.map((c) => {
          const active = scope.kind === 'collection' && scope.id === c.id;
          return (
            <li key={c.id}>
              <div
                className={`group flex items-center justify-between rounded px-2 py-1.5 ${
                  active ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onScopeChange({ kind: 'collection', id: c.id })}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: c.color ?? '#94a3b8' }}
                    aria-hidden
                  />
                  <span className="truncate">{c.name}</span>
                </button>
                {editing ? (
                  <button
                    type="button"
                    onClick={() => void removeCollection(c.id)}
                    className="ml-2 text-xs text-rose-500 hover:underline"
                  >
                    ×
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">{collectionCounts[c.id] ?? 0}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex gap-1">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('sidebar.collectionsCreate')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addCollection();
          }}
          className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void addCollection()}
          disabled={!newName.trim()}
          className="rounded bg-brand-500 px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          +
        </button>
      </div>

      <div className="mt-8 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t('sidebar.marketplaces')}
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
  count?: number;
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
      {count == null ? null : countTone === 'badge' && count > 0 ? (
        <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
          {count}
        </span>
      ) : (
        <span className="text-xs text-slate-400">{count}</span>
      )}
    </button>
  );
}
