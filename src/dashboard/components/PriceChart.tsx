import { useMemo } from 'react';
import {
  CartesianGrid,
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
import { rangeCutoff, type Range } from '@/services/price-history';

interface Props {
  points: PricePoint[];
  aggregates: PriceHistoryAggregates;
  range: Range;
  onRangeChange: (r: Range) => void;
}

const RANGE_LABELS: Record<Range, string> = {
  '7d': '7д',
  '30d': '30д',
  '90d': '90д',
  all: 'Всё',
};

export function PriceChart({ points, aggregates, range, onRangeChange }: Props) {
  const cutoff = rangeCutoff(range);
  const filtered = useMemo(
    () =>
      points
        .filter((p) => p.timestamp >= cutoff)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((p) => ({ ts: p.timestamp, price: p.price })),
    [points, cutoff],
  );

  const empty = filtered.length === 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">График цены</h3>
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

      <div className="mt-4 h-64">
        {empty ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            {points.length === 0
              ? 'Истории пока нет — она начнёт накапливаться при заходах на карточку товара.'
              : 'Нет точек за выбранный период.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filtered} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
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
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0].payload as { ts: number; price: number };
                  return (
                    <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm">
                      <div className="font-medium text-slate-900">{formatPrice(p.price)}</div>
                      <div className="text-slate-500">
                        {new Intl.DateTimeFormat('ru-RU', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }).format(new Date(p.ts))}
                      </div>
                    </div>
                  );
                }}
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
              <Line
                type="monotone"
                dataKey="price"
                stroke="#2563eb"
                strokeWidth={2}
                dot={filtered.length < 30 ? { r: 3 } : false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
