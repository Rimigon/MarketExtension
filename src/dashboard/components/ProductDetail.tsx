import { useEffect, useMemo, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import { formatPrice, formatPercent, formatDateTime } from '@/shared/format';
import { MARKETPLACE_LABELS } from '@/shared/constants';
import type { Collection, PricePoint, PriceTier, Product } from '@/shared/types';
import type { PriceHistoryAggregates } from '@/services/price-history';
import { PriceChart } from './PriceChart';
import type { Range } from '@/services/price-history';
import { ProductMeta } from './ProductMeta';

interface Props {
  product: Product;
  collections: Collection[];
  onRemove: () => void;
  onChanged: () => void;
}

const EMPTY_AGGREGATES: PriceHistoryAggregates = {
  count: 0,
  current: null,
  min: null,
  max: null,
  avg: null,
  currentVsAvg: null,
  lastChange: null,
  delta24h: null,
  delta7d: null,
  delta30d: null,
  minAt: null,
  maxAt: null,
};

export function ProductDetail({ product, collections, onRemove, onChanged }: Props) {
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [aggregates, setAggregates] = useState<PriceHistoryAggregates>(EMPTY_AGGREGATES);
  const [range, setRange] = useState<Range>('30d');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshHint, setRefreshHint] = useState<string | null>(null);

  const lifetimeTrend = useMemo(() => {
    if (points.length < 2 || product.currentPrice == null) return null;
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const first = sorted[0];
    if (!first || first.price <= 0) return null;
    const abs = product.currentPrice - first.price;
    if (abs === 0) return null;
    return { abs, pct: abs / first.price };
  }, [points, product.currentPrice]);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    void sendRpc('priceHistory/get', { productId: product.id }).then((resp) => {
      if (cancelled) return;
      setPoints(resp.points);
      setAggregates(resp.aggregates);
      setHistoryLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-slate-50">
      <header className="flex items-start gap-4 border-b border-slate-200 bg-white px-6 py-5">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="h-20 w-20 rounded-md object-cover" />
        ) : (
          <div className="h-20 w-20 rounded-md bg-slate-100" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {MARKETPLACE_LABELS[product.marketplace]}
            {product.brand ? ` · ${product.brand}` : ''}
            {product.sku ? ` · артикул ${product.sku}` : ''}
          </div>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{product.title}</h2>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-2xl font-semibold text-slate-900">
              {formatPrice(product.currentPrice)}
            </span>
            {product.oldPrice && product.oldPrice > (product.currentPrice ?? 0) && (
              <span className="text-sm text-slate-400 line-through">
                {formatPrice(product.oldPrice)}
              </span>
            )}
            {lifetimeTrend &&
              (lifetimeTrend.pct < 0 ? (
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  −{formatPercent(Math.abs(lifetimeTrend.pct))} с момента добавления
                </span>
              ) : (
                <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                  +{formatPercent(lifetimeTrend.pct)} с момента добавления
                </span>
              ))}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <a
            href={product.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-brand-500 hover:underline"
          >
            Открыть карточку ↗
          </a>
          <button
            type="button"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              setRefreshHint(null);
              try {
                const resp = await sendRpc('product/refresh', { productId: product.id });
                if (resp.ok) {
                  setRefreshHint('Цена обновлена');
                  onChanged();
                } else if (resp.reason === 'not_supported') {
                  setRefreshHint('Откройте карточку в браузере — цена подтянется автоматически');
                } else {
                  setRefreshHint(`Не удалось обновить: ${resp.message ?? resp.reason}`);
                }
              } finally {
                setRefreshing(false);
              }
            }}
            className="text-xs text-brand-500 hover:underline disabled:opacity-50"
          >
            {refreshing ? 'Обновляю…' : 'Обновить цену'}
          </button>
          {refreshHint && (
            <span className="max-w-[160px] text-right text-[10px] text-slate-500">
              {refreshHint}
            </span>
          )}
          <button
            onClick={onRemove}
            className="text-xs text-rose-600 hover:underline"
            type="button"
          >
            Удалить
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-5 px-6 py-5">
        <DetailsBlock product={product} />

        {product.description && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Описание
            </h3>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{product.description}</p>
          </section>
        )}

        <StatsGrid aggregates={aggregates} loading={historyLoading} />

        <PriceChart
          points={points}
          aggregates={aggregates}
          range={range}
          onRangeChange={setRange}
        />

        <PriceTiersBlock tiers={product.priceTiers} fallback={product} />

        <ProductMeta product={product} collections={collections} onChanged={onChanged} />

        {product.specs && product.specs.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Характеристики
            </h3>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
              {product.specs.map((s, i) => (
                <SpecRow key={`${s.name}-${i}`} name={s.name} value={s.value} />
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}

function StatsGrid({ aggregates, loading }: { aggregates: PriceHistoryAggregates; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[68px] animate-pulse rounded-lg border border-slate-200 bg-slate-50" />
        ))}
      </div>
    );
  }

  const currentVsAvgValue =
    aggregates.currentVsAvg == null
      ? '—'
      : `${aggregates.currentVsAvg > 0 ? '+' : ''}${formatPercent(aggregates.currentVsAvg)}`;
  const currentVsAvgTone =
    aggregates.currentVsAvg == null
      ? 'neutral'
      : aggregates.currentVsAvg < 0
        ? 'good'
        : aggregates.currentVsAvg > 0
          ? 'bad'
          : 'neutral';

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Минимум" value={formatPrice(aggregates.min)} hint={tsHint(aggregates.minAt)} tone="good" />
      <Stat label="Максимум" value={formatPrice(aggregates.max)} hint={tsHint(aggregates.maxAt)} tone="bad" />
      <Stat label="Средняя" value={formatPrice(aggregates.avg)} hint={`${aggregates.count} точек`} />
      <Stat label="Сейчас vs средняя" value={currentVsAvgValue} tone={currentVsAvgTone} />
      <Stat
        label="Δ за 24ч"
        value={deltaText(aggregates.delta24h?.pct)}
        hint={aggregates.delta24h ? `${deltaAbs(aggregates.delta24h.abs)}` : undefined}
        tone={deltaTone(aggregates.delta24h?.pct)}
      />
      <Stat
        label="Δ за 7д"
        value={deltaText(aggregates.delta7d?.pct)}
        hint={aggregates.delta7d ? `${deltaAbs(aggregates.delta7d.abs)}` : undefined}
        tone={deltaTone(aggregates.delta7d?.pct)}
      />
      <Stat
        label="Δ за 30д"
        value={deltaText(aggregates.delta30d?.pct)}
        hint={aggregates.delta30d ? `${deltaAbs(aggregates.delta30d.abs)}` : undefined}
        tone={deltaTone(aggregates.delta30d?.pct)}
      />
      <Stat
        label="Последнее изменение"
        value={aggregates.lastChange == null ? '—' : deltaAbs(aggregates.lastChange)}
        tone={
          aggregates.lastChange == null
            ? 'neutral'
            : aggregates.lastChange < 0
              ? 'good'
              : aggregates.lastChange > 0
                ? 'bad'
                : 'neutral'
        }
      />
    </div>
  );
}

type Tone = 'neutral' | 'good' | 'bad';

function Stat({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint?: string; tone?: Tone }) {
  const toneClass =
    tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-base font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function deltaText(pct: number | undefined): string {
  if (pct == null) return '—';
  if (pct === 0) return '0%';
  return `${pct > 0 ? '+' : ''}${formatPercent(pct)}`;
}

function deltaAbs(abs: number): string {
  const formatted = formatPrice(Math.abs(abs));
  if (abs > 0) return `+${formatted}`;
  if (abs < 0) return `−${formatted}`;
  return formatted;
}

function deltaTone(pct: number | undefined): Tone {
  if (pct == null || pct === 0) return 'neutral';
  return pct < 0 ? 'good' : 'bad';
}

function tsHint(ts: number | null): string | undefined {
  if (ts == null) return undefined;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(new Date(ts));
}

function PriceTiersBlock({ tiers, fallback }: { tiers: PriceTier[] | undefined; fallback: Product }) {
  const list: PriceTier[] = tiers && tiers.length > 0
    ? tiers
    : [
        ...(fallback.currentPrice != null
          ? [{ label: 'Со скидкой', amount: fallback.currentPrice, kind: 'discounted' as const }]
          : []),
        ...(fallback.oldPrice != null
          ? [{ label: 'Без скидки', amount: fallback.oldPrice, kind: 'original' as const }]
          : []),
      ];
  if (list.length === 0) return null;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Цены</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {list.map((t, i) => (
          <li key={`${t.kind}-${i}`} className="grid grid-cols-[180px_1fr] items-baseline gap-2">
            <span className="text-xs text-slate-500">{t.label}</span>
            <span
              className={
                t.kind === 'original'
                  ? 'text-slate-400 line-through'
                  : t.kind === 'discounted'
                    ? 'font-semibold text-emerald-700'
                    : 'text-slate-900'
              }
            >
              {formatPrice(t.amount)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DetailsBlock({ product }: { product: Product }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Сведения</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
        <DetailRow label="Наличие" value={availabilityLabel(product.availability)} />
        <DetailRow
          label="Рейтинг"
          value={product.rating != null ? product.rating.toFixed(1) : '—'}
        />
        <DetailRow
          label="Отзывов"
          value={product.reviewCount != null ? product.reviewCount.toLocaleString('ru-RU') : '—'}
        />
        <DetailRow label="Парсер" value={parserStatusLabel(product.parserStatus)} />
        <DetailRow label="Добавлен" value={formatDateTime(product.addedAt)} />
        <DetailRow label="Обновлён" value={formatDateTime(product.updatedAt)} />
      </dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value}</dd>
    </div>
  );
}

function SpecRow({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{name}</dt>
      <dd className="text-slate-900">{value}</dd>
    </>
  );
}

function availabilityLabel(a: string): string {
  switch (a) {
    case 'in_stock':
      return 'В наличии';
    case 'out_of_stock':
      return 'Нет в наличии';
    case 'limited':
      return 'Заканчивается';
    default:
      return '—';
  }
}

function parserStatusLabel(s: string): string {
  switch (s) {
    case 'ok':
      return 'OK';
    case 'partial':
      return 'Частично';
    case 'failed':
      return 'Ошибка';
    default:
      return s;
  }
}
