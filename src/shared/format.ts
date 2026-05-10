const RUB_FORMATTER = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

const PERCENT_FORMATTER = new Intl.NumberFormat('ru-RU', {
  style: 'percent',
  maximumFractionDigits: 1,
});

export function formatPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return RUB_FORMATTER.format(value);
}

export function formatPercent(ratio: number): string {
  return PERCENT_FORMATTER.format(ratio);
}

export function formatDelta(prev: number, next: number): string {
  if (prev <= 0) return '—';
  const ratio = (next - prev) / prev;
  const sign = ratio > 0 ? '+' : '';
  return `${sign}${formatPercent(ratio)}`;
}

export function formatDateTime(epoch: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(epoch));
}

/** Short label shown on cards for unavailable products. */
export function formatUnavailableLabel(reason: string): string {
  if (reason === 'not_product_page') return 'Снят с продажи';
  if (reason === 'no_price') return 'Нет в продаже';
  if (reason === 'api_returned_null') return 'Снят с продажи';
  return 'Недоступен';
}

/** Long explainer for the detail-panel banner. */
export function explainUnavailable(reason: string): string {
  if (reason === 'not_product_page')
    return 'Маркетплейс редиректит ссылку с карточки товара на поиск или категорию — товар, скорее всего, снят с продажи. Обновите URL или удалите его из отслеживания.';
  if (reason === 'no_price')
    return 'Карточка открывается, но цены на ней нет — товар закончился у всех продавцов.';
  if (reason === 'api_returned_null')
    return 'Wildberries-API вернул пустой ответ — обычно так бывает, когда товар снят с продажи.';
  return 'Маркетплейс не вернул информацию о товаре.';
}

/**
 * Compact relative timestamp: «только что», «5 мин», «2 ч», «вчера», «3 дн»,
 * fallback to a short date for older points. Designed for product cards where
 * vertical space is tight.
 */
export function formatRelative(epoch: number, now: number = Date.now()): string {
  const diffMs = now - epoch;
  if (diffMs < 0) return 'только что';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return 'только что';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'вчера';
  if (day < 7) return `${day} дн`;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(
    new Date(epoch),
  );
}
