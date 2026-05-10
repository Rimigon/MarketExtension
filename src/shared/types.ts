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
  /** Marketplace told us the product is no longer for sale: page redirects to
   *  search/category, price disappeared, or API returned null. Set by refresh
   *  handlers when the result is terminally negative; cleared on the next
   *  successful refresh. UI surfaces this so the user can update the URL or
   *  remove the product. */
  unavailable?: ProductUnavailable;
}

export type UnavailableReason =
  | 'not_product_page'
  | 'no_price'
  | 'api_returned_null';

export interface ProductUnavailable {
  reason: UnavailableReason;
  /** First refresh after which we noticed the product is gone. */
  since: number;
  /** Most recent refresh that confirmed the state. */
  lastCheckedAt: number;
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

export type NotificationDetails =
  | {
      kind: 'rule';
      trigger: NotificationTrigger;
      cooldownMinutes: number;
      before: { price: number; availability: Availability; discountPct: number | null } | null;
      after: { price: number; availability: Availability; discountPct: number | null };
      historyMinBefore: number | null;
      productSnapshot: {
        title: string;
        marketplace: Marketplace;
        url: string;
        imageUrl?: string;
        parserStatus: ParserStatus;
      };
    }
  | {
      kind: 'scheduledBulk';
      total: number;
      succeeded: number;
      /** Real failures only (network, parser bugs, timeouts). Products that
       *  the marketplace confirmed as delisted/out-of-sale go into
       *  `unavailable`/`unavailables` instead — they're informational, not errors. */
      failed: number;
      /** Count of products marked as unavailable during this run. */
      unavailable?: number;
      changes: { id: string; title: string; before: number; after: number }[];
      /** Per-product errors captured from parserDiagnostics around the run. */
      errors?: { productId: string; title: string; status: ParserStatus; missingFields: string[] }[];
      /** Per-product unavailable list — separate from errors so the user can
       *  triage them differently (delete or update URL, vs retry). */
      unavailables?: { productId: string; title: string; reason: UnavailableReason }[];
    };

export interface AppNotification {
  id: string;
  productId: string;
  ruleId: string;
  title: string;
  body: string;
  createdAt: number;
  readAt?: number;
  /** Optional structured context for the dashboard's detail panel. */
  details?: NotificationDetails;
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

/**
 * 10 hand-picked palettes (5 light + 5 dark) plus 'auto' which follows the
 * OS prefers-color-scheme. The actual color tokens live in `src/shared/themes.ts`.
 */
export type ThemeId =
  | 'auto'
  | 'light-default'
  | 'light-cream'
  | 'light-mint'
  | 'light-sky'
  | 'light-rose'
  | 'dark-slate'
  | 'dark-midnight'
  | 'dark-forest'
  | 'dark-violet'
  | 'dark-amber';

/** How the dashboard renders the product list. */
export type ProductDisplayMode = 'list' | 'grid' | 'cards';

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
  theme: ThemeId;
  excludedDomains: string[];
  locale: 'ru' | 'en';
  /** Show a colored stripe per marketplace in product lists. */
  marketplaceColorCoding: boolean;
  /** Dashboard product list rendering mode. */
  displayMode: ProductDisplayMode;
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
