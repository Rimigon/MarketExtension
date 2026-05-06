import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { Collection, Marketplace, Product } from '@/shared/types';
import { MARKETPLACE_LABELS, MARKETPLACES } from '@/shared/constants';
import { t } from '@/shared/i18n';

interface SchedulerStatus {
  enabled: boolean;
  nextRunAt: number | null;
  queueSize: number;
  mode: 'interval' | 'daily';
  intervalMinutes: number;
  dailyAtHour: number | null;
  lastRunAt: number | null;
}

export type ScopeFilter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'archived' }
  | { kind: 'notifications' }
  | { kind: 'stats' }
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
  /** Increments after each refresh — Sidebar re-polls scheduler/status when it changes. */
  schedulerBump: number;
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
  schedulerBump,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await sendRpc('scheduler/status', {});
        if (!cancelled) {
          setSchedulerStatus(status);
          setNow(Date.now());
        }
      } catch {
        // SW asleep or RPC unavailable — keep last value
      }
    };
    void refresh();
    // Tick the clock and re-poll status every minute. The clock decides
    // "вот-вот / через N мин"; the poll catches when scheduler advances
    // nextRunAt after a successful tick.
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const poll = setInterval(() => void refresh(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      clearInterval(poll);
    };
  }, []);

  // Re-poll immediately when the parent signals a refresh just happened —
  // nextRunAt advances after each successful task, this keeps the hint live.
  useEffect(() => {
    if (schedulerBump === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await sendRpc('scheduler/status', {});
        if (!cancelled) {
          setSchedulerStatus(status);
          setNow(Date.now());
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schedulerBump]);

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
    <aside className="flex h-full flex-col overflow-y-auto border-r border-slate-200 bg-slate-50/40 px-4 py-6">
      <div className="px-2 text-lg font-semibold text-slate-900">PriceWatch</div>
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

      {schedulerStatus?.enabled && (
        <div className="mt-auto pt-6">
          <SchedulerHint
            status={schedulerStatus}
            now={now}
            onRefreshTimer={() => setNow(Date.now())}
          />
        </div>
      )}
    </aside>
  );
}

function SchedulerHint({
  status,
  now,
  onRefreshTimer,
}: {
  status: SchedulerStatus;
  now: number;
  onRefreshTimer: () => void;
}) {
  const next = status.nextRunAt;
  const modeLine =
    status.mode === 'daily'
      ? `Раз в сутки в ${String(status.dailyAtHour ?? 0).padStart(2, '0')}:00`
      : `Каждые ${formatInterval(status.intervalMinutes)}`;

  if (next == null) {
    return (
      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <div className="font-medium text-slate-900">{modeLine}</div>
        <div className="mt-0.5 text-slate-500">Ожидаем первую проверку…</div>
      </div>
    );
  }
  const inMs = next - now;
  // Once `nextRunAt` has passed, the alarm tick (1 min period) will dispatch
  // shortly. Show "≤1 мин" instead of stale "вот-вот…" for clarity.
  const inLabel =
    inMs <= 0 ? '≤ 1 мин' : `~${formatRelative(inMs)}`;

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      <div className="flex items-center justify-between">
        <div className="font-medium text-slate-900">{modeLine}</div>
        <button
          type="button"
          onClick={onRefreshTimer}
          title="Обновить таймер"
          className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
      </div>
      <div className="mt-0.5 text-slate-500">
        Через {inLabel}
        <span className="text-slate-400"> · {formatTime(next)}</span>
      </div>
      {status.queueSize > 0 && (
        <div className="text-[11px] text-slate-400">
          {status.queueSize} {pluralProducts(status.queueSize)}
        </div>
      )}
    </div>
  );
}

function pluralProducts(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'товар';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'товара';
  return 'товаров';
}

function formatInterval(min: number): string {
  if (min < 60) return `${min} мин`;
  if (min === 60) return 'час';
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.round(h / 24)} сут`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `сегодня в ${hh}:${mm}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()
  ) {
    return `завтра в ${hh}:${mm}`;
  }
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

function formatRelative(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} сек`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч ${min % 60 ? `${min % 60} мин` : ''}`.trim();
  return `${Math.round(h / 24)} сут`;
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
