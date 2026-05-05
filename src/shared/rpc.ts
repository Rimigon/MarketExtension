import type { ParsedProduct, Product } from './types';

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
