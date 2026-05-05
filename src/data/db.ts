import Dexie, { type Table } from 'dexie';
import type {
  AppNotification,
  Collection,
  NotificationRule,
  ParserDiagnostic,
  PricePoint,
  Product,
  ProductEvent,
  UserSettings,
} from '@/shared/types';

export class PriceWatchDB extends Dexie {
  products!: Table<Product, string>;
  pricePoints!: Table<PricePoint, string>;
  events!: Table<ProductEvent, string>;
  notifications!: Table<AppNotification, string>;
  collections!: Table<Collection, string>;
  notificationRules!: Table<NotificationRule, string>;
  settings!: Table<UserSettings, 'singleton'>;
  parserDiagnostics!: Table<ParserDiagnostic, string>;

  constructor() {
    super('pricewatch');

    this.version(1).stores({
      products:
        'id, marketplace, canonicalUrl, [marketplace+sku], updatedAt, isArchived, isFavorite, *tags, *collectionIds',
      pricePoints: 'id, productId, timestamp, [productId+timestamp]',
      events: 'id, productId, timestamp, type',
      notifications: 'id, productId, createdAt, readAt',
      collections: 'id, name, sortOrder',
      notificationRules: 'id',
      settings: 'id',
      parserDiagnostics: 'id, marketplace, timestamp, status',
    });
  }
}

let _db: PriceWatchDB | null = null;

/**
 * Lazy singleton — Dexie instance is opened only when first accessed.
 * Important for service worker, where the SW may be torn down and re-spawned.
 */
export function db(): PriceWatchDB {
  if (!_db) _db = new PriceWatchDB();
  return _db;
}

/** Test-only: drop the database and clear the singleton so the next db() call recreates a fresh one. */
export async function resetDb(): Promise<void> {
  if (_db) {
    try { await _db.delete(); } catch { /* ignore */ }
    _db = null;
  }
}
