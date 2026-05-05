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
  passiveUpdates: true,
  scheduledUpdates: false,
  maxNotificationsPerHour: 5,
  theme: 'auto' as const,
  excludedDomains: [] as string[],
  locale: 'ru' as const,
};
