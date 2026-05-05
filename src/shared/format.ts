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
