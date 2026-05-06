import type {
  AppNotification,
  Collection,
  NotificationRule,
  ParsedProduct,
  PriceGoal,
  PricePoint,
  Product,
  ProductEvent,
  UserSettings,
} from './types';
import type { PriceHistoryAggregates } from '@/services/price-history';
import type { Recommendation } from '@/services/recommendation';
import type { StatsOverview } from '@/services/stats';
import type { ExportPayload, ImportSummary } from '@/services/import-export';

/**
 * Typed message bus between content scripts / popup / dashboard / options
 * and the background service worker.
 *
 * Each entry: request payload → response payload.
 * Background routes by `type` to a handler in src/background/handlers.ts.
 */
export type RpcMap = {
  'product/add': {
    request: { parsed: ParsedProduct; source: 'page' | 'popup' | 'manual' };
    response: { ok: true; product: Product; created: boolean } | { ok: false; error: string };
  };
  'product/getByCanonical': {
    request: { canonicalUrl: string };
    response: { product: Product | null };
  };
  'product/getById': {
    request: { productId: string };
    response: { product: Product | null };
  };
  'product/list': {
    request: { limit?: number; archived?: boolean };
    response: { products: Product[] };
  };
  'product/remove': {
    request: { productId: string };
    response: { ok: true } | { ok: false; error: string };
  };
  'product/refresh': {
    request: { productId: string };
    response:
      | { ok: true; product: Product }
      | { ok: false; reason: 'not_supported' | 'no_product' | 'fetch_failed'; message?: string };
  };
  'product/setFavorite': {
    request: { productId: string; favorite: boolean };
    response: { ok: true };
  };
  'product/setArchived': {
    request: { productId: string; archived: boolean };
    response: { ok: true };
  };
  'product/setTags': {
    request: { productId: string; tags: string[] };
    response: { ok: true };
  };
  'product/setCollections': {
    request: { productId: string; collectionIds: string[] };
    response: { ok: true };
  };
  'product/setNotes': {
    request: { productId: string; notes: string };
    response: { ok: true };
  };
  'product/setGoal': {
    request: { productId: string; goal: PriceGoal | null };
    response: { ok: true };
  };
  'product/events': {
    request: { productId: string };
    response: { events: ProductEvent[] };
  };
  'priceHistory/get': {
    request: { productId: string; since?: number };
    response: { points: PricePoint[]; aggregates: PriceHistoryAggregates };
  };
  'priceTrends/list': {
    request: Record<string, never>;
    response: {
      /** productId → lifetime change vs the earliest recorded point. null если истории < 2 точек. */
      trends: Record<string, { abs: number; pct: number; firstPrice: number; firstAt: number } | null>;
    };
  };
  'recommendation/get': {
    request: { productId: string };
    response: { recommendation: Recommendation };
  };
  'collections/list': {
    request: Record<string, never>;
    response: { collections: Collection[] };
  };
  'collections/upsert': {
    request: { collection: { id?: string; name: string; color?: string; sortOrder?: number } };
    response: { collection: Collection };
  };
  'collections/remove': {
    request: { id: string };
    response: { ok: true };
  };
  'stats/overview': {
    request: Record<string, never>;
    response: { overview: StatsOverview };
  };
  'data/export': {
    request: Record<string, never>;
    response: { payload: ExportPayload };
  };
  'data/import': {
    request: { payload: ExportPayload };
    response: { summary: ImportSummary };
  };
  'notifications/list': {
    request: { limit?: number; unreadOnly?: boolean };
    response: { items: AppNotification[] };
  };
  'notifications/unreadCount': {
    request: Record<string, never>;
    response: { count: number };
  };
  'notifications/markRead': {
    request: { id: string };
    response: { ok: true };
  };
  'notifications/markAllRead': {
    request: Record<string, never>;
    response: { ok: true };
  };
  'notifications/remove': {
    request: { id: string };
    response: { ok: true };
  };
  'notifications/removeAll': {
    request: Record<string, never>;
    response: { ok: true; removed: number };
  };
  'notificationRules/list': {
    request: Record<string, never>;
    response: { rules: NotificationRule[] };
  };
  'notificationRules/upsert': {
    request: { rule: Omit<NotificationRule, 'id'> & { id?: string } };
    response: { rule: NotificationRule };
  };
  'notificationRules/remove': {
    request: { id: string };
    response: { ok: true };
  };
  'settings/get': {
    request: Record<string, never>;
    response: { settings: UserSettings };
  };
  'settings/update': {
    request: { patch: Partial<Omit<UserSettings, 'id'>> };
    response: { settings: UserSettings };
  };
  'scheduler/lastSummary': {
    request: Record<string, never>;
    response: {
      summary:
        | {
            total: number;
            succeeded: number;
            failed: number;
            changes: { id: string; title: string; before: number; after: number }[];
          }
        | null;
      at: number | null;
    };
  };
  'scheduler/status': {
    request: Record<string, never>;
    response: {
      enabled: boolean;
      /** When the next bulk refresh fires (epoch ms). Null when disabled / not yet armed. */
      nextRunAt: number | null;
      /** Number of active products that will be refreshed on the next tick. */
      queueSize: number;
      mode: 'interval' | 'daily';
      intervalMinutes: number;
      dailyAtHour: number | null;
      /** When the last bulk refresh completed. Null if it has never run. */
      lastRunAt: number | null;
    };
  };
  'ping': {
    request: Record<string, never>;
    response: { ok: true; ts: number };
  };
};

export type RpcType = keyof RpcMap;

export interface RpcEnvelope<T extends RpcType = RpcType> {
  type: T;
  payload: RpcMap[T]['request'];
}

export type RpcResponse<T extends RpcType> = RpcMap[T]['response'];

/**
 * Send a typed message to the background service worker. Returns the response.
 * Wraps chrome.runtime.sendMessage in a Promise with proper typing.
 */
export function sendRpc<T extends RpcType>(
  type: T,
  payload: RpcMap[T]['request'],
): Promise<RpcResponse<T>> {
  return new Promise((resolve, reject) => {
    const envelope: RpcEnvelope<T> = { type, payload };
    chrome.runtime.sendMessage(envelope, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response as RpcResponse<T>);
    });
  });
}

export type RpcHandler<T extends RpcType> = (
  payload: RpcMap[T]['request'],
  sender: chrome.runtime.MessageSender,
) => Promise<RpcResponse<T>>;

export type RpcHandlerMap = { [K in RpcType]: RpcHandler<K> };
