import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PricePoint } from '@/shared/types';
import { formatPrice } from '@/shared/format';
import type { PriceHistoryAggregates } from '@/services/price-history';
import { bucketByDay, rangeCutoff, type Range } from '@/services/price-history';

interface Props {
  points: PricePoint[];
  aggregates: PriceHistoryAggregates;
  range: Range;
  onRangeChange: (r: Range) => void;
}

type ChartType = 'line' | 'area' | 'step' | 'bars' | 'range';

const RANGE_LABELS: Record<Range, string> = {
  '7d': '7д',
  '30d': '30д',
  '90d': '90д',
  all: 'Всё',
};

const CHART_LABELS: Record<ChartType, string> = {
  line: 'Линия',
  area: 'Область',
  step: 'Ступени',
  bars: 'По дням',
  range: 'Диапазон',
};

const CHART_HINTS: Record<ChartType, string> = {
  line: 'Гладкая линия по точкам цены',
  area: 'Линия с заливкой — нагляден общий уровень',
  step: 'Цена меняется скачком — линия не интерполирует между точками',
  bars: 'Закрытие по дням — высота столбца = цена в конце дня',
  range: 'Диапазон цен за день: от минимума к максимуму',
};

export function PriceChart({ points, aggregates, range, onRangeChange }: Props) {
  // Receipt aesthetic: prices change in discrete steps, so the chart should
  // too. Users can still flip to 'line' / 'area' / 'bars' / 'range' from the
  // toolbar above.
  const [chartType, setChartType] = useState<ChartType>('step');
  const cutoff = rangeCutoff(range);

  const filtered = useMemo(
    () =>
      points
        .filter((p) => p.timestamp >= cutoff)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((p) => ({ ts: p.timestamp, price: p.price })),
    [points, cutoff],
  );

  const dailyBuckets = useMemo(() => {
    const inRange = points.filter((p) => p.timestamp >= cutoff);
    return bucketByDay(inRange).map((b) => ({
      ts: b.ts,
      close: b.close,
      min: b.min,
      max: b.max,
      // Recharts renders array values as a floating bar (from low to high).
      span: [b.min, b.max] as [number, number],
      // Color the daily-close bar by direction relative to the previous close.
      // Filled in below in a separate map step.
    }));
  }, [points, cutoff]);

  const dailyWithDirection = useMemo(() => {
    return dailyBuckets.map((b, i) => {
      const prev = i > 0 ? dailyBuckets[i - 1]!.close : b.close;
      const dir: 'up' | 'down' | 'flat' =
        b.close > prev ? 'up' : b.close < prev ? 'down' : 'flat';
      return { ...b, dir };
    });
  }, [dailyBuckets]);

  const empty =
    chartType === 'bars' || chartType === 'range'
      ? dailyWithDirection.length === 0
      : filtered.length === 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">График цены</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md bg-slate-100 p-0.5 text-xs">
            {(Object.keys(CHART_LABELS) as ChartType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setChartType(t)}
                title={CHART_HINTS[t]}
                className={`rounded px-2 py-1 ${
                  chartType === t
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {CHART_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-md bg-slate-100 p-0.5 text-xs">
            {(['7d', '30d', '90d', 'all'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRangeChange(r)}
                className={`rounded px-2 py-1 ${
                  range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 h-64">
        {empty ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            {points.length === 0
              ? 'Истории пока нет — она начнёт накапливаться при заходах на карточку товара.'
              : 'Нет точек за выбранный период.'}
          </div>
        ) : chartType === 'line' || chartType === 'step' ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filtered} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              {commonChartChildren(aggregates)}
              {pointTooltip()}
              <Line
                type={chartType === 'step' ? 'stepAfter' : 'monotone'}
                dataKey="price"
                stroke="#2563eb"
                strokeWidth={2}
                dot={filtered.length < 30 ? { r: 3 } : false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : chartType === 'area' ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={filtered} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pwAreaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              {commonChartChildren(aggregates)}
              {pointTooltip()}
              <Area
                type="monotone"
                dataKey="price"
                stroke="#2563eb"
                strokeWidth={2}
                fill="url(#pwAreaFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : chartType === 'bars' ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyWithDirection} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              {commonChartChildren(aggregates, { categorical: true })}
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0].payload as {
                    ts: number;
                    close: number;
                    min: number;
                    max: number;
                  };
                  return (
                    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm">
                      <div className="pw-num font-medium text-slate-900">{formatPrice(p.close)}</div>
                      <div className="text-slate-500">
                        мин <span className="pw-num">{formatPrice(p.min)}</span> · макс{' '}
                        <span className="pw-num">{formatPrice(p.max)}</span>
                      </div>
                      <div className="pw-num text-slate-400">{formatDay(p.ts)}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="close" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {dailyWithDirection.map((b, i) => (
                  <Cell
                    key={i}
                    fill={b.dir === 'down' ? '#10b981' : b.dir === 'up' ? '#ef4444' : '#94a3b8'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          // chartType === 'range' — daily min-max floating bars
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyWithDirection} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              {commonChartChildren(aggregates, { categorical: true })}
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0].payload as {
                    ts: number;
                    close: number;
                    min: number;
                    max: number;
                  };
                  return (
                    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm">
                      <div className="pw-num font-medium text-slate-900">
                        {formatPrice(p.min)} – {formatPrice(p.max)}
                      </div>
                      <div className="text-slate-500">
                        закрытие <span className="pw-num">{formatPrice(p.close)}</span>
                      </div>
                      <div className="pw-num text-slate-400">{formatDay(p.ts)}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="span" radius={[3, 3, 3, 3]} isAnimationActive={false}>
                {dailyWithDirection.map((b, i) => (
                  <Cell
                    key={i}
                    fill={b.dir === 'down' ? '#10b981' : b.dir === 'up' ? '#ef4444' : '#64748b'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// Shared axis/grid/reference-line/tooltip elements that nest inside a Recharts
// chart. Returned as a fragment so each top-level chart can mix in its own
// series component (Line/Area/Bar) without duplicating boilerplate.
function commonChartChildren(aggregates: PriceHistoryAggregates, opts?: { categorical?: boolean }) {
  const categorical = opts?.categorical ?? false;
  return (
    <>
      <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
      <XAxis
        dataKey="ts"
        {...(categorical
          ? {}
          : {
              type: 'number' as const,
              domain: ['dataMin', 'dataMax'] as [string, string],
              scale: 'time' as const,
            })}
        tickFormatter={(v) =>
          new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(v))
        }
        stroke="#94a3b8"
        fontSize={11}
        tickLine={false}
      />
      <YAxis
        stroke="#94a3b8"
        fontSize={11}
        tickLine={false}
        width={70}
        tickFormatter={(v) => formatPrice(Number(v))}
        domain={['dataMin', 'dataMax']}
        style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
      />
      {aggregates.avg != null && (
        <ReferenceLine
          y={aggregates.avg}
          stroke="#94a3b8"
          strokeDasharray="4 4"
          label={{ value: 'avg', position: 'right', fill: '#94a3b8', fontSize: 11 }}
        />
      )}
      {aggregates.min != null && (
        <ReferenceLine y={aggregates.min} stroke="#10b981" strokeDasharray="4 4" />
      )}
      {aggregates.max != null && (
        <ReferenceLine y={aggregates.max} stroke="#ef4444" strokeDasharray="4 4" />
      )}
    </>
  );
}

function pointTooltip() {
  return (
    <Tooltip
      content={({ active, payload }) => {
        if (!active || !payload || payload.length === 0) return null;
        const p = payload[0].payload as { ts: number; price?: number };
        if (p.price == null) return null;
        return (
          <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm">
            <div className="pw-num font-medium text-slate-900">{formatPrice(p.price)}</div>
            <div className="pw-num text-slate-500">
              {new Intl.DateTimeFormat('ru-RU', {
                dateStyle: 'short',
                timeStyle: 'short',
              }).format(new Date(p.ts))}
            </div>
          </div>
        );
      }}
    />
  );
}

function formatDay(ts: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(ts));
}
