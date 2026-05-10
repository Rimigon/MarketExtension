import { formatDateTime, formatPrice, formatUnavailableLabel, explainUnavailable } from '@/shared/format';
import { MARKETPLACE_LABELS } from '@/shared/constants';
import type {
  AppNotification,
  Availability,
  NotificationDetails,
  NotificationTrigger,
  Product,
} from '@/shared/types';

interface Props {
  notification: AppNotification;
  product: Product | null;
  onOpenProduct: (productId: string) => void;
}

const AVAILABILITY_LABELS: Record<Availability, string> = {
  in_stock: 'В наличии',
  out_of_stock: 'Нет в наличии',
  limited: 'Ограниченно',
  unknown: 'Неизвестно',
};

export function NotificationDetail({ notification, product, onOpenProduct }: Props) {
  const details = notification.details;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-slate-200 px-6 py-4">
        <div className="text-xs uppercase tracking-wide text-slate-400">Уведомление</div>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">{notification.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{notification.body}</p>
        <div className="mt-2 text-xs text-slate-400">{formatDateTime(notification.createdAt)}</div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 py-5">
        {details?.kind === 'rule' && (
          <RuleDetails details={details} product={product} onOpenProduct={onOpenProduct} />
        )}

        {details?.kind === 'scheduledBulk' && <BulkDetails details={details} />}

        {!details && (
          <p className="text-sm text-slate-500">
            Подробной информации нет — это старое уведомление, оно появилось до того,
            как мы стали сохранять контекст.
          </p>
        )}
      </div>
    </div>
  );
}

function RuleDetails({
  details,
  product,
  onOpenProduct,
}: {
  details: Extract<NotificationDetails, { kind: 'rule' }>;
  product: Product | null;
  onOpenProduct: (productId: string) => void;
}) {
  const { trigger, before, after, historyMinBefore, productSnapshot, cooldownMinutes } = details;
  const priceDelta =
    before != null ? { abs: after.price - before.price, prev: before.price, next: after.price } : null;
  const dropPct =
    before != null && before.price > 0 ? ((before.price - after.price) / before.price) * 100 : null;

  return (
    <>
      <Section title="Что произошло">
        <Row label="Сработало правило" value={describeTrigger(trigger)} />
        {priceDelta && (
          <Row
            label="Цена"
            value={
              <span>
                {formatPrice(priceDelta.prev)}{' '}
                <span className="text-slate-400">→</span> <strong>{formatPrice(priceDelta.next)}</strong>
                {dropPct != null && Math.abs(dropPct) >= 0.5 && (
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                      dropPct > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {dropPct > 0 ? '−' : '+'}
                    {Math.abs(dropPct).toFixed(1)}%
                  </span>
                )}
              </span>
            }
          />
        )}
        {!priceDelta && <Row label="Цена" value={<strong>{formatPrice(after.price)}</strong>} />}
        {before && before.availability !== after.availability && (
          <Row
            label="Наличие"
            value={`${AVAILABILITY_LABELS[before.availability]} → ${AVAILABILITY_LABELS[after.availability]}`}
          />
        )}
        {after.discountPct != null && after.discountPct > 0 && (
          <Row label="Скидка" value={`−${after.discountPct}%`} />
        )}
        {historyMinBefore != null && (
          <Row label="Минимум до этого" value={formatPrice(historyMinBefore)} />
        )}
        <Row
          label="Кулдаун правила"
          value={`${formatCooldown(cooldownMinutes)} — повтор не сработает раньше`}
        />
      </Section>

      <Section title="Товар">
        <div className="flex gap-3">
          {productSnapshot.imageUrl ? (
            <img
              src={productSnapshot.imageUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded object-cover"
            />
          ) : (
            <div className="h-16 w-16 shrink-0 rounded bg-slate-100" />
          )}
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-sm font-medium text-slate-900">
              {productSnapshot.title}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {MARKETPLACE_LABELS[productSnapshot.marketplace]}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {product ? (
                <button
                  type="button"
                  onClick={() => onOpenProduct(product.id)}
                  className="rounded bg-brand-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-600"
                >
                  Открыть карточку
                </button>
              ) : (
                <span className="rounded bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                  Товар удалён из отслеживания
                </span>
              )}
              <a
                href={productSnapshot.url}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                На сайте маркетплейса ↗
              </a>
            </div>
          </div>
        </div>

        {productSnapshot.parserStatus !== 'ok' && (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            На момент уведомления парсер вернул <strong>{productSnapshot.parserStatus}</strong> —
            часть полей могла прийти не полностью. Проверьте в карточке товара, всё ли в порядке.
          </div>
        )}
      </Section>

    </>
  );
}

function BulkDetails({
  details,
}: {
  details: Extract<NotificationDetails, { kind: 'scheduledBulk' }>;
}) {
  const { total, succeeded, failed, changes, errors, unavailable, unavailables } = details;
  return (
    <>
      <Section title="Итог проверки">
        <Row label="Всего товаров" value={String(total)} />
        <Row label="Успешно обновлено" value={String(succeeded)} tone={succeeded ? 'good' : undefined} />
        <Row label="С ошибкой" value={String(failed)} tone={failed ? 'bad' : undefined} />
        {unavailable != null && unavailable > 0 && (
          <Row label="Снято с продажи" value={String(unavailable)} />
        )}
        <Row label="Цена изменилась" value={String(changes.length)} />
      </Section>

      {changes.length > 0 && (
        <Section title="Изменения цены">
          <ul className="space-y-1.5">
            {changes.map((c) => {
              const dropPct = c.before > 0 ? ((c.before - c.after) / c.before) * 100 : 0;
              const went = c.after < c.before;
              return (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs ${
                      went ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {went ? '↓' : '↑'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-slate-900">{c.title}</span>
                    <span className="block text-xs text-slate-500">
                      {formatPrice(c.before)} → <strong>{formatPrice(c.after)}</strong>{' '}
                      <span className="text-slate-400">
                        ({went ? '−' : '+'}
                        {Math.abs(dropPct).toFixed(1)}%)
                      </span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {errors && errors.length > 0 && (
        <Section title="Ошибки">
          <ul className="space-y-2">
            {errors.map((e) => {
              const rawCode = e.missingFields[0] ?? 'unknown';
              const friendly = explainError(rawCode);
              const sameAsCode = friendly === rawCode;
              return (
                <li
                  key={e.productId}
                  className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
                >
                  <div className="line-clamp-1 font-medium text-rose-900">{e.title}</div>
                  <div className="mt-0.5 break-words text-rose-700">{friendly}</div>
                  {/* Hide the technical row when the friendly text == the raw
                      code (no translation available) — otherwise it just shows
                      the same string twice. */}
                  {!sameAsCode && (
                    <div className="mt-1 font-mono text-[11px] text-rose-500">{rawCode}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {unavailables && unavailables.length > 0 && (
        <Section title="Снятые с продажи">
          <p className="mb-2 text-xs text-slate-500">
            Маркетплейс не вернул цену для этих товаров — это не сбой проверки,
            а сигнал, что товар, скорее всего, больше не продаётся. В списке
            они отмечены янтарной плашкой.
          </p>
          <ul className="space-y-2">
            {unavailables.map((u) => (
              <li
                key={u.productId}
                className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                <div className="line-clamp-1 font-medium">
                  ⚠ {u.title}
                </div>
                <div className="mt-0.5 text-amber-800">
                  <strong>{formatUnavailableLabel(u.reason)}.</strong>{' '}
                  {explainUnavailable(u.reason)}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {failed === 0 && (!unavailables || unavailables.length === 0) && (
        <p className="text-sm text-slate-500">
          Все товары обновлены успешно — ошибок не было.
        </p>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'good' | 'bad';
}) {
  const toneClass =
    tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${toneClass}`}>{value}</span>
    </div>
  );
}

function describeTrigger(t: NotificationTrigger): string {
  switch (t.kind) {
    case 'priceBelow':
      return `Цена опустилась ниже ${formatPrice(t.value)}`;
    case 'dropPct':
      return `Цена упала на ${Math.round(t.value * 100)}% или больше`;
    case 'dropAbs':
      return `Цена упала на ${formatPrice(t.value)} или больше`;
    case 'discountAppeared':
      return 'Появилась скидка';
    case 'backInStock':
      return 'Товар снова в наличии';
    case 'historicalLow':
      return 'Новый исторический минимум';
    case 'sellerChanged':
      return 'Сменился продавец';
  }
}

function formatCooldown(min: number): string {
  if (min < 60) return `${min} мин`;
  if (min < 60 * 24) return `${Math.round(min / 60)} ч`;
  return `${Math.round(min / 60 / 24)} сут`;
}

function explainError(reason: string): string {
  if (reason === 'not_implemented:tab_refresh')
    return 'Маркетплейс пока не поддерживает фоновое обновление через API. Откройте страницу товара или нажмите «Обновить» вручную.';
  if (reason === 'tab_load_timeout')
    return 'Страница не успела загрузиться за отведённое время. Обычно — медленное соединение или маркетплейс под нагрузкой.';
  if (reason === 'not_product_page')
    return 'Товар, скорее всего, снят с продажи: ссылка ведёт уже не на карточку (маркетплейс редиректит на поиск или категорию). Удалите его из отслеживания или обновите URL.';
  if (reason === 'parser_status_failed' || reason === 'parser_failed')
    return 'Страница загрузилась, но парсер не смог распознать карточку. Возможно, маркетплейс показал капчу или поменял вёрстку.';
  if (reason === 'no_price')
    return 'Карточка открылась, но цены на ней нет — обычно так бывает, когда товар закончился у всех продавцов.';
  if (reason.startsWith('no_response')) return 'Парсер не успел распарсить страницу. Попробуйте ещё раз.';
  if (reason === 'invalid_url') return 'Сохранён некорректный URL товара.';
  if (reason === 'no_nm_in_url') return 'В URL нет идентификатора товара (nm). Обновите ссылку.';
  if (reason === 'api_returned_null')
    return 'API маркетплейса вернул пустой ответ — возможно, товар снят с продажи.';
  if (reason === 'tabs_api_unavailable')
    return 'Браузер не дал расширению создать вкладку для обновления.';
  return reason;
}
