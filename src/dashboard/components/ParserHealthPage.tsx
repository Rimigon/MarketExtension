import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import { MARKETPLACE_LABELS, MARKETPLACES } from '@/shared/constants';
import { formatDateTime } from '@/shared/format';
import type { Marketplace } from '@/shared/types';
import type {
  ParserHealthBucket,
  ParserHealthRecentFailure,
  ParserHealthReport,
} from '@/services/parser-health';

export function ParserHealthPage() {
  const [report, setReport] = useState<ParserHealthReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void sendRpc('parserHealth/get', {}).then((resp) => {
      if (cancelled) return;
      setReport(resp.report);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="col-span-2 flex items-center justify-center text-sm text-slate-500">
        Считаем здоровье парсеров…
      </div>
    );
  }
  if (!report) return null;

  return (
    <div className="col-span-2 overflow-y-auto overscroll-contain bg-slate-50 px-8 py-6">
      <h1 className="text-xl font-semibold text-slate-900">Здоровье парсеров</h1>
      <p className="mt-1 text-sm text-slate-500">
        Считаем по записям таблицы <code className="rounded bg-slate-100 px-1">parserDiagnostics</code>.
        Сводка обновлена {formatDateTime(report.generatedAt)}. Записи старше 30 дней автоматически
        вычищаются.
      </p>

      {report.alarm && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <strong>Внимание:</strong> успешность за 7 дней ниже 80%. Скорее всего, изменилась вёрстка
          одного из маркетплейсов — посмотрите топ‑полей и последние сбои ниже, добавьте новые
          селекторы.
        </div>
      )}

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <BucketBlock title="За 24 часа" buckets={report.last24h} />
        <BucketBlock title="За 7 дней" buckets={report.last7d} />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Топ отсутствующих полей · 7 дней
          </h3>
          {report.topMissingFields7d.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              Парсеры не пропустили ни одного поля за неделю — поздравляем.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {report.topMissingFields7d.map((f) => (
                <li key={f.field} className="flex items-center justify-between py-1.5">
                  <code className="text-slate-700">{f.field}</code>
                  <span className="font-medium text-slate-900">{f.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Затронутые активные товары
          </h3>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{report.affectedProducts}</p>
          <p className="mt-1 text-xs text-slate-500">
            Сейчас в списке отслеживания {report.affectedProducts === 0 ? 'нет' : 'есть'} товары
            со статусом парсера ≠ ok. У них последняя цена может быть не точной — обновите вручную
            или дождитесь следующего фонового прогона.
          </p>
        </div>
      </section>

      <section className="mt-6">
        <RecentFailuresBlock failures={report.recentFailures} />
      </section>
    </div>
  );
}

function BucketBlock({
  title,
  buckets,
}: {
  title: string;
  buckets: Record<Marketplace, ParserHealthBucket>;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">
        {MARKETPLACES.map((m) => {
          const b = buckets[m as Marketplace];
          const tone =
            b.successRate == null
              ? 'neutral'
              : b.successRate >= 0.95
                ? 'good'
                : b.successRate >= 0.8
                  ? 'neutral'
                  : 'bad';
          return (
            <li key={m} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2">
              <span className="text-slate-700">{MARKETPLACE_LABELS[m]}</span>
              <span className="text-xs text-slate-500">
                {b.total === 0
                  ? 'нет данных'
                  : `${b.ok} ок · ${b.partial} частично · ${b.failed} ошибок`}
              </span>
              <span
                className={`min-w-[48px] text-right font-semibold ${
                  tone === 'good'
                    ? 'text-emerald-700'
                    : tone === 'bad'
                      ? 'text-rose-700'
                      : 'text-slate-900'
                }`}
              >
                {b.successRate == null ? '—' : `${Math.round(b.successRate * 100)}%`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RecentFailuresBlock({ failures }: { failures: ParserHealthRecentFailure[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Последние сбои
      </h3>
      {failures.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">Пока нет.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {failures.map((f) => (
            <li key={f.id} className="grid grid-cols-[80px_1fr_auto] items-baseline gap-3 py-2">
              <span
                className={`rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${
                  f.status === 'failed'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {f.status === 'failed' ? 'ошибка' : 'частично'}
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs text-slate-500">
                  {MARKETPLACE_LABELS[f.marketplace]} · парсер v{f.parserVersion}
                </div>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm text-brand-500 hover:underline"
                  title={f.url}
                >
                  {f.displayUrl}
                </a>
                {f.missingFields.length > 0 && (
                  <div className="mt-0.5 text-xs text-slate-500">
                    Отсутствуют:{' '}
                    {f.missingFields.map((mf, i) => (
                      <code
                        key={`${f.id}-${i}`}
                        className="mx-0.5 rounded bg-slate-100 px-1 text-[11px]"
                      >
                        {mf}
                      </code>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-right text-xs text-slate-500">
                {formatDateTime(f.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
