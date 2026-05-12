import { useEffect } from 'react';
import { formatPrice, formatPercent } from '@/shared/format';

export interface BulkRefreshSummary {
  total: number;
  succeeded: number;
  failed: number;
  changes: { id: string; title: string; before: number; after: number }[];
}

interface Props {
  summary: BulkRefreshSummary | null;
  onClose: () => void;
}

/**
 * Floating panel shown after «Обновить все» finishes. Lists how many products
 * actually changed price; auto-dismisses after a few seconds unless the user
 * is interacting with it.
 */
export function BulkRefreshToast({ summary, onClose }: Props) {
  useEffect(() => {
    if (!summary) return;
    const t = setTimeout(onClose, 12_000);
    return () => clearTimeout(t);
  }, [summary, onClose]);

  if (!summary) return null;

  const drops = summary.changes.filter((c) => c.after < c.before);
  const rises = summary.changes.filter((c) => c.after > c.before);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[320px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
        <div className="text-sm font-medium text-slate-900">
          Обновлено {summary.succeeded} из {summary.total}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700"
          aria-label="Закрыть"
        >
          ✕
        </button>
      </div>
      <div className="px-3 py-2 text-xs text-slate-600">
        {summary.failed > 0 && (
          <div className="mb-2 rounded bg-rose-50 px-2 py-1 text-rose-700">
            Не удалось обновить: {summary.failed}
          </div>
        )}
        {summary.changes.length === 0 ? (
          <p>Цены без изменений.</p>
        ) : (
          <>
            <div className="flex gap-3">
              {drops.length > 0 && (
                <span className="text-emerald-700">↓ {drops.length}</span>
              )}
              {rises.length > 0 && (
                <span className="text-rose-700">↑ {rises.length}</span>
              )}
              <span className="text-slate-500">
                · без изменений {summary.succeeded - summary.changes.length}
              </span>
            </div>
            <ul className="mt-2 max-h-[260px] space-y-1.5 overflow-y-auto">
              {summary.changes.slice(0, 12).map((c) => {
                const diff = c.after - c.before;
                const pct = (diff / c.before) * 100;
                const isDrop = diff < 0;
                return (
                  <li key={c.id} className="border-t border-slate-100 pt-1.5 first:border-0 first:pt-0">
                    <div className="line-clamp-1 text-slate-900">{c.title}</div>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="pw-num text-slate-400 line-through">{formatPrice(c.before)}</span>
                      <span className="text-slate-500">→</span>
                      <span className="pw-num font-medium text-slate-900">{formatPrice(c.after)}</span>
                      <span className={`pw-num ${isDrop ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {isDrop ? '−' : '+'}
                        {formatPercent(Math.abs(pct / 100))}
                      </span>
                    </div>
                  </li>
                );
              })}
              {summary.changes.length > 12 && (
                <li className="pt-1 text-[11px] text-slate-500">
                  и ещё {summary.changes.length - 12}…
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
