export type Marketplace = 'ozon' | 'wildberries' | 'yandex-market';

export type Availability = 'in_stock' | 'out_of_stock' | 'limited' | 'unknown';

export type ParserStatus = 'ok' | 'partial' | 'failed';

export type PriceSource = 'visit' | 'scheduled' | 'manual';

export interface PriceGoal {
  targetPrice?: number;
  idealPrice?: number;
  deadline?: number;
}

export interface ProductSpec {
  name: string;
  value: string;
}

export type PriceTierKind = 'discounted' | 'regular' | 'original';

export interface PriceTier {
  /** Human label as shown by the marketplace, e.g. «С банками», «С другими банками», «Без скидки». */
  label: string;
  amount: number;
  kind: PriceTierKind;
}

export interface Product {
  id: string;
  marketplace: Marketplace;
  url: string;
  canonicalUrl: string;
  sku: string | null;
  title: string;
  brand?: string;
  imageUrl?: string;
  currentPrice: number | null;
  oldPrice: number | null;
  currency: 'RUB';
  discountPct: number | null;
  availability: Availability;
  priceTiers?: PriceTier[];
  rating?: number;
  reviewCount?: number;
  description?: string;
  specs?: ProductSpec[];
  addedAt: number;
  updatedAt: number;
  lastSeenAt: number;
  parserVersion: number;
  parserStatus: ParserStatus;
  isArchived: boolean;
  isFavorite: boolean;
  notes?: string;
  tags: string[];
  collectionIds: string[];
  groupId?: string;
  goal?: PriceGoal;
}

export interface PricePoint {
  id: string;
  productId: string;
  price: number;
  oldPrice: number | null;
  availability: Availability;
  timestamp: number;
  source: PriceSource;
}

export type ProductEventType =
  | 'added'
  | 'priceChanged'
  | 'outOfStock'
  | 'backInStock'
  | 'sellerChanged'
  | 'discountAppeared'
  | 'targetUpdated'
  | 'parserFailed'
  | 'archived'
  | 'restored';

export interface ProductEvent {
  id: string;
  productId: string;
  type: ProductEventType;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export type NotificationTrigger =
  | { kind: 'priceBelow'; value: number }
  | { kind: 'dropPct'; value: number }
  | { kind: 'dropAbs'; value: number }
  | { kind: 'discountAppeared' }
  | { kind: 'backInStock' }
  | { kind: 'historicalLow' }
  | { kind: 'sellerChanged' };

export interface NotificationRule {
  id: string;
  scope: { kind: 'global' } | { kind: 'product'; productId: string };
  trigger: NotificationTrigger;
  enabled: boolean;
  cooldownMinutes: number;
}

export interface AppNotification {
  id: string;
  productId: string;
  ruleId: string;
  title: string;
  body: string;
  createdAt: number;
  readAt?: number;
}

export interface Collection {
  id: string;
  name: string;
  color?: string;
  isSystem?: boolean;
  sortOrder: number;
}

/** Update interval in minutes. 1440 = once a day. */
export type UpdateIntervalMinutes = 15 | 30 | 60 | 180 | 360 | 720 | 1440;

export interface UserSettings {
  id: 'singleton';
  updateInterval: UpdateIntervalMinutes;
  /**
   * If set, scheduled updates run once a day at this hour (0–23) regardless
   * of `updateInterval`. Local time. Null = use interval mode.
   */
  dailyAtHour: number | null;
  passiveUpdates: boolean;
  scheduledUpdates: boolean;
  quietHours?: { from: string; to: string };
  maxNotificationsPerHour: number;
  theme: 'light' | 'dark' | 'auto';
  excludedDomains: string[];
  locale: 'ru' | 'en';
  /** Show a colored stripe per marketplace in product lists. */
  marketplaceColorCoding: boolean;
}

/**
 * Output of a parser — what content scripts extract from the page.
 * Subset of Product fields; the repository fills in id/timestamps/flags.
 */
export interface ParsedProduct {
  marketplace: Marketplace;
  url: string;
  canonicalUrl: string;
  sku: string | null;
  title: string;
  brand?: string;
  imageUrl?: string;
  currentPrice: number | null;
  oldPrice: number | null;
  discountPct: number | null;
  availability: Availability;
  priceTiers?: PriceTier[];
  rating?: number;
  reviewCount?: number;
  description?: string;
  specs?: ProductSpec[];
  parserVersion: number;
  parserStatus: ParserStatus;
}

export interface ParserDiagnostic {
  id: string;
  marketplace: Marketplace;
  parserVersion: number;
  status: ParserStatus;
  url: string;
  missingFields: string[];
  timestamp: number;
}
