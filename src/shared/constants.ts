import type { Marketplace } from './types';

export const APP_NAME = 'PriceWatch';

export const MARKETPLACES: Marketplace[] = ['ozon', 'wildberries', 'yandex-market'];

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  ozon: 'Ozon',
  wildberries: 'Wildberries',
  'yandex-market': 'Яндекс Маркет',
};

export const MARKETPLACE_HOSTS: Record<Marketplace, string[]> = {
  ozon: ['ozon.ru', 'www.ozon.ru'],
  wildberries: ['wildberries.ru', 'www.wildberries.ru'],
  'yandex-market': ['market.yandex.ru'],
};

export const DEFAULT_SETTINGS = {
  id: 'singleton' as const,
  updateInterval: 60 as const,
  /** null = use interval mode; 0–23 = run once a day at that local hour. */
  dailyAtHour: null as number | null,
  passiveUpdates: true,
  scheduledUpdates: false,
  quietHours: null as { from: string; to: string } | null,
  maxNotificationsPerHour: 5,
  theme: 'auto' as const,
  excludedDomains: [] as string[],
  locale: 'ru' as const,
  marketplaceColorCoding: true,
  displayMode: 'list' as const,
};

/** Marketplace brand colors for the colored-stripe in product lists. */
export const MARKETPLACE_ACCENT: Record<Marketplace, { stripe: string; bg: string; label: string }> = {
  ozon: { stripe: '#005bff', bg: '#e6f0ff', label: 'text-[#003ea8]' },
  wildberries: { stripe: '#cb11ab', bg: '#fdebf7', label: 'text-[#7a0a66]' },
  'yandex-market': { stripe: '#FED42B', bg: '#fff7d1', label: 'text-[#5c4a00]' },
};
