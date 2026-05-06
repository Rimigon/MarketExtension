import { useState, type CSSProperties } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { Marketplace, ParsedProduct, Product } from '@/shared/types';
import { formatPrice } from '@/shared/format';

type Status = 'idle' | 'tracked' | 'pending' | 'error';

interface Props {
  parsed: ParsedProduct;
  initialProduct: Product | null;
  onChange?: (product: Product | null) => void;
}

interface Theme {
  fontFamily: string;
  button: CSSProperties;
  tracked: CSSProperties;
  trackedTextColor: string;
  trackedLinkColor: string;
  pendingLabel: string;
  ctaLabel: string;
}

/**
 * Per-marketplace styles. Each theme tries to match the host site's primary CTA
 * (color, border-radius, font) so the «Следить» button doesn't look bolted on.
 * All values are inline because we render inside a Shadow DOM — no CSS file is loaded.
 */
const THEMES: Record<Marketplace, Theme> = {
  ozon: {
    fontFamily: '"Ozon Display","Helvetica Neue",Helvetica,Arial,sans-serif',
    button: {
      background: '#005bff',
      color: '#fff',
      borderRadius: 16,
      fontWeight: 500,
      padding: '10px 18px',
      fontSize: 14,
      letterSpacing: 0,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    },
    tracked: {
      background: '#e6f0ff',
      border: '1px solid #99baff',
      color: '#003ea8',
      borderRadius: 16,
      padding: '8px 14px',
    },
    trackedTextColor: '#003ea8',
    trackedLinkColor: '#005bff',
    pendingLabel: 'Сохраняю…',
    ctaLabel: 'Следить за ценой',
  },
  wildberries: {
    fontFamily:
      '"Golos Text","TildaSans","Helvetica Neue",Helvetica,Arial,sans-serif',
    button: {
      background: '#cb11ab',
      color: '#fff',
      borderRadius: 8,
      fontWeight: 700,
      padding: '11px 18px',
      fontSize: 14,
      letterSpacing: 0,
      boxShadow: '0 1px 2px rgba(203,17,171,0.15)',
    },
    tracked: {
      background: '#fdebf7',
      border: '1px solid #f0a8de',
      color: '#7a0a66',
      borderRadius: 8,
      padding: '9px 14px',
    },
    trackedTextColor: '#7a0a66',
    trackedLinkColor: '#cb11ab',
    pendingLabel: 'Сохраняю…',
    ctaLabel: 'Следить за ценой',
  },
  'yandex-market': {
    fontFamily: '"YS Text","Helvetica Neue",Helvetica,Arial,sans-serif',
    button: {
      background: '#FED42B',
      color: '#1f1f1f',
      borderRadius: 12,
      fontWeight: 600,
      padding: '11px 18px',
      fontSize: 14,
      letterSpacing: 0,
      boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
    },
    tracked: {
      background: '#fff7d1',
      border: '1px solid #f0d04a',
      color: '#5c4a00',
      borderRadius: 12,
      padding: '9px 14px',
    },
    trackedTextColor: '#5c4a00',
    trackedLinkColor: '#a37e00',
    pendingLabel: 'Сохраняю…',
    ctaLabel: 'Следить за ценой',
  },
};

export function TrackButton({ parsed, initialProduct, onChange }: Props) {
  const [product, setProduct] = useState<Product | null>(initialProduct);
  const [status, setStatus] = useState<Status>(initialProduct ? 'tracked' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);

  const theme = THEMES[parsed.marketplace];
  const tracked = status === 'tracked' && product;

  async function track() {
    setStatus('pending');
    setError(null);
    try {
      const resp = await sendRpc('product/add', { parsed, source: 'page' });
      if (resp.ok) {
        setProduct(resp.product);
        setStatus('tracked');
        onChange?.(resp.product);
      } else {
        setError(resp.error);
        setStatus('error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  async function untrack() {
    if (!product) return;
    setStatus('pending');
    try {
      await sendRpc('product/remove', { productId: product.id });
      setProduct(null);
      setStatus('idle');
      onChange?.(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  const buttonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    cursor: status === 'pending' ? 'wait' : 'pointer',
    transition: 'filter 120ms ease, transform 120ms ease',
    filter: hover && status !== 'pending' ? 'brightness(0.94)' : 'none',
    transform: hover && status !== 'pending' ? 'translateY(-1px)' : 'none',
    ...theme.button,
  };

  return (
    <div
      style={{
        fontFamily: theme.fontFamily,
        margin: '12px 0',
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {tracked ? (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            fontWeight: 500,
            ...theme.tracked,
          }}
        >
          <span style={{ color: theme.trackedTextColor }}>
            ✓ Отслеживается · {formatPrice(product!.currentPrice)}
          </span>
          <button
            onClick={untrack}
            style={{
              fontSize: 12,
              background: 'transparent',
              border: 'none',
              color: theme.trackedLinkColor,
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'inherit',
            }}
          >
            убрать
          </button>
        </div>
      ) : (
        <button
          onClick={track}
          disabled={status === 'pending'}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={buttonStyle}
        >
          {status === 'pending' ? theme.pendingLabel : theme.ctaLabel}
        </button>
      )}
      {error && <div style={{ fontSize: 12, color: '#b91c1c' }}>Ошибка: {error}</div>}
    </div>
  );
}
