import { sendRpc } from '@/shared/rpc';
import { formatDateTime } from '@/shared/format';
import type { AppNotification, Product } from '@/shared/types';

interface Props {
  notifications: AppNotification[];
  productsById: Map<string, Product>;
  selectedProductId: string | null;
  onSelectProduct: (productId: string) => void;
  onChange: () => void;
}

export function NotificationsList({
  notifications,
  productsById,
  selectedProductId,
  onSelectProduct,
  onChange,
}: Props) {
  async function markAll() {
    await sendRpc('notifications/markAllRead', {});
    onChange();
  }

  return (
    <div className="flex h-full flex-col border-r border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Уведомления</h2>
        {notifications.some((n) => n.readAt == null) && (
          <button
            type="button"
            onClick={markAll}
            className="text-xs text-brand-500 hover:underline"
          >
            Прочитать всё
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">
            Уведомлений ещё нет. Они придут, когда сработает одно из правил —
            например, цена упадёт на 5% или товар вернётся в наличие.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {notifications.map((n) => {
              const product = productsById.get(n.productId);
              const unread = n.readAt == null;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={async () => {
                      onSelectProduct(n.productId);
                      if (unread) {
                        await sendRpc('notifications/markRead', { id: n.id });
                        onChange();
                      }
                    }}
                    className={`grid w-full grid-cols-[40px_1fr] items-start gap-3 px-4 py-3 text-left ${
                      selectedProductId === n.productId ? 'bg-brand-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    {product?.imageUrl ? (
                      <img src={product.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-slate-100" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`truncate text-sm ${
                            unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'
                          }`}
                        >
                          {n.title}
                        </span>
                        {unread && (
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">{n.body}</div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        {formatDateTime(n.createdAt)}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
