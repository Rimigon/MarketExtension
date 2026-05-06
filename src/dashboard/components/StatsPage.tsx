import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import { formatPrice, formatPercent } from '@/shared/format';
import { MARKETPLACE_LABELS } from '@/shared/constants';
import type { ProductMover, StatsOverview } from '@/services/stats';

interface Props {
  onSelectProduct: (productId: string) => void;
}

export function StatsPage({ onSelectProduct }: Props) {
  const [overview, setOverview] = useState<StatsOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sendRpc('stats/overview', {}).then((resp) => {
      if (!cancelled) setOverview(resp.overview);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!overview) {
    return (
      <div className="col-span-2 flex items-center justify-center text-sm text-slate-500">
        Считаем агрегаты…
      </div>
    );
  }

  return (
    <div className="col-span-2 overflow-y-auto bg-slate-50 px-8 py-6">
      <h1 className="text-xl font-semibold text-slate-900">Аналитика</h1>
      <p className="mt-1 text-sm text-slate-500">
        Сводка по всем активным товарам, обновляется при открытии страницы.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Всего отслеживается" value={overview.totalActive.toString()} />
        <Stat label="В избранном" value={overview.totalFavorites.toString()} />
        <Stat label="В архиве" value={overview.totalArchived.toString()} />
        <Stat
          label="Точек истории"
          value={overview.pricePointsCount.toLocaleString('ru-RU')}
        />
        <Stat
          label="Подешевело за 7д"
          value={overview.drops7dCount.toString()}
          tone="good"
        />
        <Stat
          label="Подорожало за 7д"
          value={overview.rises7dCount.toString()}
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
          title="Топ падений (7 дней)"
          movers={overview.topDrops7d}
          tone="good"
          onSelect={onSelectProduct}
          emptyHint="Пока ни один товар не подешевел за неделю."
        />
        <MoversBlock
          title="Топ ростов (7 дней)"
          movers={overview.topRises7d}
          tone="bad"
          onSelect={onSelectProduct}
          emptyHint="Никто не подорожал — счастье."
        />
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
                className="grid w-full grid-cols-[40px_1fr_auto] items-center gap-3 py-2 text-left hover:bg-slate-50"
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
