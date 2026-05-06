import type {
  AppNotification,
  NotificationRule,
  ParsedProduct,
  PricePoint,
  Product,
  UserSettings,
} from './types';
import type { PriceHistoryAggregates } from '@/services/price-history';

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
    response: { ok: boolean };
  };
  'priceHistory/get': {
    request: { productId: string; since?: number };
    response: { points: PricePoint[]; aggregates: PriceHistoryAggregates };
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
