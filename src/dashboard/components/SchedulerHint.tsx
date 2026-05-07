import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';

interface SchedulerStatus {
  enabled: boolean;
  nextRunAt: number | null;
  queueSize: number;
  mode: 'interval' | 'daily';
  intervalMinutes: number;
  dailyAtHour: number | null;
  lastRunAt: number | null;
}

interface Props {
  /** Increments after each refresh — re-polls scheduler/status when it changes. */
  bump: number;
  /** Compact pill mode for use in horizontal toolbars. */
  variant?: 'card' | 'pill';
}

/**
 * Self-contained "next refresh" status badge. Polls scheduler/status every
 * minute and shows the upcoming run. Renders nothing if scheduler is off.
 */
export function SchedulerHint({ bump, variant = 'card' }: Props) {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await sendRpc('scheduler/status', {});
        if (!cancelled) {
          setStatus(s);
          setNow(Date.now());
        }
      } catch {
        // SW asleep — keep last value
      }
    };
    void refresh();
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const poll = setInterval(() => void refresh(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (bump === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await sendRpc('scheduler/status', {});
        if (!cancelled) {
          setStatus(s);
          setNow(Date.now());
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bump]);

  if (!status?.enabled) return null;

  const modeLine =
    status.mode === 'daily'
      ? `Раз в сутки в ${String(status.dailyAtHour ?? 0).padStart(2, '0')}:00`
      : `Каждые ${formatInterval(status.intervalMinutes)}`;

  const next = status.nextRunAt;
  const inLabel =
    next == null
      ? 'ожидаем первую проверку…'
      : next - now <= 0
      ? '≤ 1 мин'
      : `~${formatRelative(next - now)}`;

  if (variant === 'pill') {
    return (
      <div
        title={
          next != null
            ? `${modeLine} · следующее обновление: ${formatTime(next)}`
            : modeLine
        }
        className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600"
      >
        <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
        <span className="truncate">
          <span className="font-medium text-slate-900">{modeLine}</span>
          <span className="text-slate-400"> · через {inLabel}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      <div className="font-medium text-slate-900">{modeLine}</div>
      {next == null ? (
        <div className="mt-0.5 text-slate-500">Ожидаем первую проверку…</div>
      ) : (
        <div className="mt-0.5 text-slate-500">
          Через {inLabel}
          <span className="text-slate-400"> · {formatTime(next)}</span>
        </div>
      )}
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
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
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
