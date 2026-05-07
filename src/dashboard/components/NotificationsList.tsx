import { sendRpc } from '@/shared/rpc';
import { formatDateTime } from '@/shared/format';
import type { AppNotification, Product } from '@/shared/types';

interface Props {
  notifications: AppNotification[];
  productsById: Map<string, Product>;
  selectedNotificationId: string | null;
  /** Called with (notificationId, productId). productId is '_global' for non-product notifications. */
  onSelectNotification: (notificationId: string, productId: string) => void;
  onChange: () => void;
}

export function NotificationsList({
  notifications,
  productsById,
  selectedNotificationId,
  onSelectNotification,
  onChange,
}: Props) {
  async function markAll() {
    await sendRpc('notifications/markAllRead', {});
    onChange();
  }

  async function removeOne(id: string) {
    await sendRpc('notifications/remove', { id });
    onChange();
  }

  async function removeAll() {
    if (!confirm(`Удалить все уведомления (${notifications.length})?`)) return;
    await sendRpc('notifications/removeAll', {});
    onChange();
  }

  const hasUnread = notifications.some((n) => n.readAt == null);

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-slate-200">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Уведомления</h2>
        <div className="flex items-center gap-3 text-xs">
          {hasUnread && (
            <button type="button" onClick={markAll} className="text-brand-500 hover:underline">
              Прочитать всё
            </button>
          )}
          {notifications.length > 0 && (
            <button type="button" onClick={removeAll} className="text-rose-600 hover:underline">
              Удалить всё
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
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
              const isGlobal = n.productId === '_global';
              const selected = selectedNotificationId === n.id;
              return (
                <li
                  key={n.id}
                  className={`group relative grid grid-cols-[40px_1fr_auto] items-start gap-3 px-4 py-3 ${
                    selected ? 'bg-brand-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={async () => {
                      onSelectNotification(n.id, n.productId);
                      if (unread) {
                        await sendRpc('notifications/markRead', { id: n.id });
                        onChange();
                      }
                    }}
                    className="contents text-left"
                  >
                    {isGlobal ? (
                      <div className="flex h-10 w-10 items-center justify-center rounded bg-brand-50 text-brand-500">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                          <path d="M21 3v5h-5" />
                          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                          <path d="M3 21v-5h5" />
                        </svg>
                      </div>
                    ) : product?.imageUrl ? (
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeOne(n.id);
                    }}
                    title="Удалить уведомление"
                    className="flex h-7 w-7 items-center justify-center rounded text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
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
