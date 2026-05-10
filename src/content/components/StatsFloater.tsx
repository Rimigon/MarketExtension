import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { Marketplace, PricePoint, Product } from '@/shared/types';
import type { PriceHistoryAggregates } from '@/services/price-history';
import {
  formatPrice,
  formatPercent,
  formatRelative,
  formatUnavailableLabel,
} from '@/shared/format';

interface Props {
  product: Product;
  /** Called when the user clicks «убрать» — parent tears down the floater. */
  onUntrack?: () => void;
}

interface MarketplaceTheme {
  /** CSS color for the accent (price, links, sparkline). */
  accent: string;
  /** Soft tint used for the collapsed pill background. */
  tint: string;
  fontFamily: string;
}

const THEMES: Record<Marketplace, MarketplaceTheme> = {
  ozon: {
    accent: '#005bff',
    tint: '#e6f0ff',
    fontFamily: '"Ozon Display","Helvetica Neue",Helvetica,Arial,sans-serif',
  },
  wildberries: {
    accent: '#cb11ab',
    tint: '#fdebf7',
    fontFamily: '"Golos Text","Helvetica Neue",Helvetica,Arial,sans-serif',
  },
  'yandex-market': {
    accent: '#a37e00',
    tint: '#fff7d1',
    fontFamily: '"YS Text","Helvetica Neue",Helvetica,Arial,sans-serif',
  },
};

const PERIOD_DAYS = 30;

/**
 * Bottom-right floating widget showing live stats for a tracked product:
 * current price, change vs last point, min/max/avg, sparkline. Collapses to a
 * compact pill so it doesn't cover marketplace UI; expand to see the full
 * panel. Renders in a Shadow DOM (inline styles only) so the host page's CSS
 * can't bleed in.
 */
export function StatsFloater({ product, onUntrack }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [points, setPoints] = useState<PricePoint[] | null>(null);
  const [aggregates, setAggregates] = useState<PriceHistoryAggregates | null>(null);
  const [busy, setBusy] = useState(false);
  const theme = THEMES[product.marketplace];

  const load = useCallback(async () => {
    const since = Date.now() - PERIOD_DAYS * 24 * 60 * 60 * 1000;
    try {
      const resp = await sendRpc('priceHistory/get', { productId: product.id, since });
      setPoints(resp.points);
      setAggregates(resp.aggregates);
    } catch {
      // Silent — floater is best-effort cosmetic UI on a third-party page.
    }
  }, [product.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refreshNow() {
    setBusy(true);
    try {
      await sendRpc('product/refresh', { productId: product.id });
      await load();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  async function openDashboard() {
    try {
      await sendRpc('dashboard/open', { productId: product.id });
    } catch {
      // ignore
    }
  }

  async function untrack() {
    if (!confirm('Убрать товар из отслеживания?')) return;
    try {
      await sendRpc('product/remove', { productId: product.id });
    } catch {
      // ignore
    }
    onUntrack?.();
  }

  const currentPrice = aggregates?.current ?? product.currentPrice;
  const lastChange = aggregates?.lastChange ?? null;
  const lastChangePct =
    lastChange != null && currentPrice != null && currentPrice - lastChange > 0
      ? lastChange / (currentPrice - lastChange)
      : null;

  const wrapperStyle: CSSProperties = {
    fontFamily: theme.fontFamily,
    color: '#0f172a',
    // Right-anchor so the expanded panel grows leftward without resizing the
    // page or causing horizontal scroll. The host element is already pinned to
    // the viewport corner (position: fixed bottom-right with 16px gap).
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8,
    pointerEvents: 'none',
  };

  return (
    <div style={wrapperStyle}>
      {expanded && (
        <Panel
          theme={theme}
          product={product}
          aggregates={aggregates}
          points={points}
          busy={busy}
          onRefresh={() => void refreshNow()}
          onOpenDashboard={() => void openDashboard()}
          onUntrack={() => void untrack()}
          onClose={() => setExpanded(false)}
        />
      )}
      <CollapsedPill
        theme={theme}
        currentPrice={currentPrice}
        lastChange={lastChange}
        lastChangePct={lastChangePct}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
    </div>
  );
}

function CollapsedPill({
  theme,
  currentPrice,
  lastChange,
  lastChangePct,
  expanded,
  onToggle,
}: {
  theme: MarketplaceTheme;
  currentPrice: number | null;
  lastChange: number | null;
  lastChangePct: number | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isDrop = lastChange != null && lastChange < 0;
  const isRise = lastChange != null && lastChange > 0;
  const trendColor = isDrop ? '#059669' : isRise ? '#dc2626' : '#64748b';

  return (
    <button
      type="button"
      onClick={onToggle}
      title={expanded ? 'Свернуть статистику' : 'Развернуть статистику PriceWatch'}
      style={{
        pointerEvents: 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: '#fff',
        color: '#0f172a',
        border: `1px solid ${theme.accent}33`,
        boxShadow: '0 6px 20px rgba(15,23,42,0.18)',
        borderRadius: 999,
        padding: '8px 14px 8px 10px',
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: 999,
          background: theme.tint,
          color: theme.accent,
          fontWeight: 700,
          fontSize: 12,
        }}
      >
        ₽
      </span>
      <span>{currentPrice != null ? formatPrice(currentPrice) : '—'}</span>
      {lastChange != null && lastChange !== 0 && lastChangePct != null && (
        <span style={{ color: trendColor, fontSize: 12, fontWeight: 600 }}>
          {isDrop ? '−' : '+'}
          {formatPercent(Math.abs(lastChangePct))}
        </span>
      )}
      <span aria-hidden style={{ color: '#94a3b8', fontSize: 11, marginLeft: 2 }}>
        {expanded ? '▾' : '▴'}
      </span>
    </button>
  );
}

function Panel({
  theme,
  product,
  aggregates,
  points,
  busy,
  onRefresh,
  onOpenDashboard,
  onUntrack,
  onClose,
}: {
  theme: MarketplaceTheme;
  product: Product;
  aggregates: PriceHistoryAggregates | null;
  points: PricePoint[] | null;
  busy: boolean;
  onRefresh: () => void;
  onOpenDashboard: () => void;
  onUntrack: () => void;
  onClose: () => void;
}) {
  const sparkValues =
    points && points.length > 0
      ? [...points].sort((a, b) => a.timestamp - b.timestamp).map((p) => p.price)
      : [];
  const min = aggregates?.min ?? null;
  const max = aggregates?.max ?? null;
  const avg = aggregates?.avg ?? null;
  const current = aggregates?.current ?? product.currentPrice;
  const minIsCurrent = min != null && current != null && Math.abs(current - min) < 0.5;
  const lastUpdated = product.updatedAt;

  return (
    <div
      style={{
        pointerEvents: 'auto',
        width: 320,
        background: '#fff',
        color: '#0f172a',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        boxShadow: '0 12px 32px rgba(15,23,42,0.22)',
        padding: 14,
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 999,
              background: theme.tint,
              color: theme.accent,
              fontWeight: 700,
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            ₽
          </span>
          <span style={{ fontWeight: 600 }}>PriceWatch</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Свернуть"
          title="Свернуть"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#64748b',
            fontSize: 16,
            padding: 0,
            lineHeight: 1,
            fontFamily: 'inherit',
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: '#64748b',
          maxHeight: 32,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
        title={product.title}
      >
        {product.title}
      </div>

      {product.unavailable && (
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#fef3c7',
            color: '#78350f',
            border: '1px solid #fcd34d',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 11,
            fontWeight: 600,
          }}
          title={`Замечено ${formatRelative(product.unavailable.since)} назад`}
        >
          <span aria-hidden>⚠</span>
          <span>{formatUnavailableLabel(product.unavailable.reason)}</span>
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: theme.accent }}>
          {current != null ? formatPrice(current) : '—'}
        </span>
        {aggregates?.lastChange != null && aggregates.lastChange !== 0 && (
          <DeltaChip change={aggregates.lastChange} basePrice={(current ?? 0) - aggregates.lastChange} />
        )}
        {minIsCurrent && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 6,
              background: '#dcfce7',
              color: '#15803d',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            мин за {PERIOD_DAYS} дн
          </span>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <InlineSparkline values={sparkValues} accent={theme.accent} />
      </div>

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Stat label="Минимум" value={min} />
        <Stat label="Среднее" value={avg} />
        <Stat label="Максимум" value={max} />
      </div>

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#64748b' }}>
        <span title={new Date(lastUpdated).toLocaleString('ru-RU')}>
          обновлено {formatRelative(lastUpdated)}
        </span>
        <span>{aggregates?.count ?? 0} {pluralPoints(aggregates?.count ?? 0)}</span>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          style={{
            flex: 1,
            background: theme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Обновляю…' : 'Обновить цену'}
        </button>
        <button
          type="button"
          onClick={onOpenDashboard}
          style={{
            flex: 1,
            background: '#f1f5f9',
            color: '#0f172a',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Открыть детали
        </button>
      </div>

      <div style={{ marginTop: 8, textAlign: 'right' }}>
        <button
          type="button"
          onClick={onUntrack}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            fontSize: 11,
            textDecoration: 'underline',
            cursor: 'pointer',
            padding: 0,
            fontFamily: 'inherit',
          }}
        >
          Не отслеживать
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
        {value != null ? formatPrice(value) : '—'}
      </div>
    </div>
  );
}

function DeltaChip({ change, basePrice }: { change: number; basePrice: number }) {
  const isDrop = change < 0;
  const pct = basePrice > 0 ? change / basePrice : 0;
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: isDrop ? '#059669' : '#dc2626',
        background: isDrop ? '#dcfce7' : '#fee2e2',
        padding: '2px 6px',
        borderRadius: 6,
      }}
    >
      {isDrop ? '−' : '+'}
      {formatPrice(Math.abs(change))} ({isDrop ? '−' : '+'}
      {formatPercent(Math.abs(pct))})
    </span>
  );
}

function InlineSparkline({ values, accent }: { values: number[]; accent: string }) {
  const width = 292;
  const height = 60;
  if (values.length < 2) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          color: '#94a3b8',
          background: '#f8fafc',
          border: '1px dashed #e2e8f0',
          borderRadius: 8,
        }}
      >
        Пока недостаточно истории для графика
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pointsAttr = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - 4 - ((v - min) / span) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  // Filled area below the line for visual weight.
  const areaPoints = `0,${height} ${pointsAttr} ${width},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`График цены: ${formatPrice(min)} – ${formatPrice(max)}`}
      style={{ display: 'block', background: '#f8fafc', borderRadius: 8 }}
    >
      <polygon points={areaPoints} fill={accent} fillOpacity={0.12} />
      <polyline
        points={pointsAttr}
        fill="none"
        stroke={accent}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function pluralPoints(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'точка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'точки';
  return 'точек';
}
