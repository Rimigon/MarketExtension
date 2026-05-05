import { useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { ParsedProduct, Product } from '@/shared/types';
import { formatPrice } from '@/shared/format';

type Status = 'idle' | 'tracked' | 'pending' | 'error';

interface Props {
  parsed: ParsedProduct;
  initialProduct: Product | null;
  onChange?: (product: Product | null) => void;
}

export function TrackButton({ parsed, initialProduct, onChange }: Props) {
  const [product, setProduct] = useState<Product | null>(initialProduct);
  const [status, setStatus] = useState<Status>(initialProduct ? 'tracked' : 'idle');
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div
      style={{
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
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
            padding: '8px 14px',
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            color: '#065f46',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <span>✓ Отслеживается · {formatPrice(product!.currentPrice)}</span>
          <button
            onClick={untrack}
            style={{
              fontSize: 12,
              background: 'transparent',
              border: 'none',
              color: '#047857',
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            убрать
          </button>
        </div>
      ) : (
        <button
          onClick={track}
          disabled={status === 'pending'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: status === 'pending' ? 'wait' : 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
        >
          {status === 'pending' ? 'Сохраняю…' : '★ Следить за ценой'}
        </button>
      )}
      {error && <div style={{ fontSize: 12, color: '#b91c1c' }}>Ошибка: {error}</div>}
    </div>
  );
}
