import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import { formatPrice, formatPercent } from '@/shared/format';
import { MARKETPLACE_LABELS, MARKETPLACES } from '@/shared/constants';
import type {
  NearGoalProduct,
  NearMinimumProduct,
  ProductMover,
  StatsOverview,
  StatsPeriodDays,
} from '@/services/stats';
import type { Marketplace } from '@/shared/types';
import { Sparkline } from './Sparkline';

interface Props {
  onSelectProduct: (productId: string) => void;
  onOpenHealth?: () => void;
}

const PERIODS: StatsPeriodDays[] = [7, 30, 90];

export function StatsPage({ onSelectProduct, onOpenHealth }: Props) {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [period, setPeriod] = useState<StatsPeriodDays>(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void sendRpc('stats/overview', { period }).then((resp) => {
      if (!cancelled) {
        setOverview(resp.overview);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [period]);

  if (!overview && loading) {
    return (
      <div className="col-span-2 flex items-center justify-center text-sm text-slate-500">
        Считаем агрегаты…
      </div>
    );
  }
  if (!overview) return null;

  const periodLabel = period === 7 ? '7 дней' : period === 30 ? '30 дней' : '90 дней';

  return (
    <div className="col-span-2 overflow-y-auto overscroll-contain bg-slate-50 px-8 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Аналитика</h1>
          <p className="mt-1 text-sm text-slate-500">
            Сводка по всем активным товарам, обновляется при открытии страницы.
          </p>
        </div>
        <PeriodSwitcher value={period} onChange={setPeriod} />
      </div>

      {overview.parserHealth.alarm && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span>
            Парсеры дают сбои:{' '}
            <strong>
              {overview.parserHealth.overallSuccessRate == null
                ? '—'
                : `${Math.round(overview.parserHealth.overallSuccessRate * 100)}%`}
            </strong>{' '}
            успешных за 7 дней. Проверьте здоровье парсеров.
          </span>
          {onOpenHealth && (
            <button
              type="button"
              onClick={onOpenHealth}
              className="shrink-0 rounded bg-amber-700 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800"
            >
              Открыть
            </button>
          )}
        </div>
      )}

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Всего отслеживается" value={overview.totalActive.toString()} />
        <Stat label="В избранном" value={overview.totalFavorites.toString()} />
        <Stat label="В архиве" value={overview.totalArchived.toString()} />
        <Stat
          label="Точек истории"
          value={overview.pricePointsCount.toLocaleString('ru-RU')}
        />
        <Stat
          label={`Подешевело за ${periodLabel}`}
          value={overview.dropsCount.toString()}
          tone="good"
        />
        <Stat
          label={`Подорожало за ${periodLabel}`}
          value={overview.risesCount.toString()}
          tone="bad"
        />
        <Stat
          label="Средняя скидка"
          value={overview.avgDiscount == null ? '—' : formatPercent(overview.avgDiscount)}
        />
        <Stat
          label="Не обновлялись > 7д"
          value={overview.staleCount.toString()}
          tone={overview.staleCount > 0 ? 'bad' : 'neutral'}
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <MoversBlock
          title={`Топ падений · ${periodLabel}`}
          movers={overview.topDrops}
          tone="good"
          onSelect={onSelectProduct}
          emptyHint={`Никто не подешевел за ${periodLabel}.`}
        />
        <MoversBlock
          title={`Топ ростов · ${periodLabel}`}
          movers={overview.topRises}
          tone="bad"
          onSelect={onSelectProduct}
          emptyHint={`Никто не подорожал за ${periodLabel} — счастье.`}
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <NearMinimumBlock items={overview.nearMinimum} onSelect={onSelectProduct} />
        <NearGoalBlock items={overview.nearGoal} onSelect={onSelectProduct} />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            По маркетплейсам
          </h3>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {Object.entries(overview.byMarketplace).map(([mp, count]) => (
              <li key={mp} className="flex items-center justify-between py-1.5">
                <span className="text-slate-700">{MARKETPLACE_LABELS[mp as keyof typeof MARKETPLACE_LABELS]}</span>
                <span className="font-medium text-slate-900">{count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Потенциал экономии
          </h3>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">
            {formatPrice(overview.potentialSavings)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Сумма разниц «текущая цена − исторический минимум» по всем активным товарам.
            Это примерная оценка того, сколько вы могли бы сэкономить, если бы покупали все на минимуме.
          </p>
        </div>
      </section>

      <section className="mt-6">
        <ParserHealthMini overview={overview} onOpen={onOpenHealth} />
      </section>
    </div>
  );
}

function PeriodSwitcher({
  value,
  onChange,
}: {
  value: StatsPeriodDays;
  onChange: (v: StatsPeriodDays) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={`rounded px-3 py-1 ${
            value === p ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          {p}д
        </button>
      ))}
    </div>
  );
}

function MoversBlock({
  title,
  movers,
  tone,
  onSelect,
  emptyHint,
}: {
  title: string;
  movers: ProductMover[];
  tone: 'good' | 'bad';
  onSelect: (id: string) => void;
  emptyHint: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {movers.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">{emptyHint}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {movers.map((m) => (
            <li key={m.productId}>
              <button
                type="button"
                onClick={() => onSelect(m.productId)}
                className="grid w-full grid-cols-[40px_1fr_80px_auto] items-center gap-3 py-2 text-left hover:bg-slate-50"
              >
                {m.imageUrl ? (
                  <img src={m.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded bg-slate-100" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{m.title}</div>
                  <div className="text-xs text-slate-500">
                    {MARKETPLACE_LABELS[m.marketplace]} · {formatPrice(m.prev)} → {formatPrice(m.current)}
                  </div>
                </div>
                <Sparkline values={m.spark} tone={tone} />
                <div
                  className={`text-right text-sm font-semibold ${
                    tone === 'good' ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {m.pct > 0 ? '+' : ''}
                  {formatPercent(m.pct)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NearMinimumBlock({
  items,
  onSelect,
}: {
  items: NearMinimumProduct[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
        Близко к историческому минимуму
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Цена в пределах 5% от наблюдавшегося минимума — хороший момент посмотреть.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Сейчас никого нет рядом с минимумом.</p>
      ) : (
        <ul className="mt-2 divide-y divide-emerald-100">
          {items.map((p) => (
            <li key={p.productId}>
              <button
                type="button"
                onClick={() => onSelect(p.productId)}
                className="grid w-full grid-cols-[40px_1fr_80px_auto] items-center gap-3 py-2 text-left hover:bg-emerald-50"
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded bg-slate-100" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{p.title}</div>
                  <div className="text-xs text-slate-500">
                    {MARKETPLACE_LABELS[p.marketplace]} · мин {formatPrice(p.min)}
                  </div>
                </div>
                <Sparkline values={p.spark} tone="good" />
                <div className="text-right text-sm font-semibold text-emerald-700">
                  {p.distancePct === 0 ? 'на минимуме' : `+${formatPercent(p.distancePct)}`}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NearGoalBlock({ items, onSelect }: { items: NearGoalProduct[]; onSelect: (id: string) => void }) {
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/30 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-700">
        Скоро цели
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Текущая цена ≤ 5% от вашей целевой. Уже достигнутые отмечены отрицательным расстоянием.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          Ни у одного товара цена ещё не подошла близко к цели. Добавьте цели в карточке товара.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-brand-100">
          {items.map((p) => (
            <li key={p.productId}>
              <button
                type="button"
                onClick={() => onSelect(p.productId)}
                className="grid w-full grid-cols-[40px_1fr_auto] items-center gap-3 py-2 text-left hover:bg-brand-50"
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded bg-slate-100" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{p.title}</div>
                  <div className="text-xs text-slate-500">
                    {MARKETPLACE_LABELS[p.marketplace]} · цель {formatPrice(p.target)} · сейчас{' '}
                    {formatPrice(p.current)}
                  </div>
                </div>
                <div
                  className={`text-right text-sm font-semibold ${
                    p.distancePct <= 0 ? 'text-emerald-700' : 'text-brand-700'
                  }`}
                >
                  {p.distancePct <= 0
                    ? 'достигнута'
                    : `+${formatPercent(p.distancePct)}`}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ParserHealthMini({ overview, onOpen }: { overview: StatsOverview; onOpen?: () => void }) {
  const buckets = overview.parserHealth.byMarketplace;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Здоровье парсеров · 7 дней
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {overview.parserHealth.overallSuccessRate == null
              ? 'Пока нет диагностических записей.'
              : `${Math.round(
                  overview.parserHealth.overallSuccessRate * 100,
                )}% успешных, ${overview.parserHealth.failures7d} сбоев.`}
          </p>
        </div>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="text-xs text-brand-500 hover:underline"
          >
            Подробнее →
          </button>
        )}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 text-sm">
        {MARKETPLACES.map((m) => {
          const b = buckets[m as Marketplace];
          const rate = b.total === 0 ? null : b.ok / b.total;
          const tone =
            rate == null ? 'neutral' : rate >= 0.95 ? 'good' : rate >= 0.8 ? 'neutral' : 'bad';
          return (
            <li key={m} className="rounded border border-slate-100 bg-slate-50 p-2">
              <div className="text-xs text-slate-500">{MARKETPLACE_LABELS[m]}</div>
              <div
                className={`mt-1 text-base font-semibold ${
                  tone === 'good'
                    ? 'text-emerald-700'
                    : tone === 'bad'
                      ? 'text-rose-700'
                      : 'text-slate-900'
                }`}
              >
                {rate == null ? '—' : `${Math.round(rate * 100)}%`}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {b.total === 0 ? 'нет данных' : `${b.ok}/${b.total} ок · ${b.failed} ошибок`}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  const toneClass =
    tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-base font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
