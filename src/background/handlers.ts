import type { RpcHandlerMap } from '@/shared/rpc';
import { productsRepo } from '@/data/products.repo';
import { pricesRepo } from '@/data/prices.repo';
import { eventsRepo } from '@/data/events.repo';
import { notificationsRepo } from '@/data/notifications.repo';
import { notificationRulesRepo } from '@/data/notification-rules.repo';
import { priceHistory } from '@/services/price-history';
import { processProductUpdate, refreshBadge } from './notifier';
import { applySettings, reconcileQueue } from './scheduler';
import { updateQueue } from './scheduler/queue';
import { settingsRepo } from '@/data/settings.repo';
import type { PriceTransition } from '@/services/notifications';

export const handlers: RpcHandlerMap = {
  ping: async () => ({ ok: true, ts: Date.now() }),

  'product/add': async ({ parsed, source }) => {
    const existing = await productsRepo.getByCanonicalUrl(parsed.canonicalUrl);
    const priceSource = source === 'page' ? 'visit' : 'manual';
    if (existing) {
      const prevSnapshot =
        existing.currentPrice != null
          ? {
              price: existing.currentPrice,
              availability: existing.availability,
              discountPct: existing.discountPct,
            }
          : null;
      const historyMinBefore = await pricesRepo.minPriceForProduct(existing.id);

      const updated = (await productsRepo.updateFromParsed(existing.id, parsed, 'visit')) ?? existing;
      if (parsed.currentPrice != null && parsed.parserStatus !== 'failed') {
        await pricesRepo.record({
          productId: updated.id,
          price: parsed.currentPrice,
          oldPrice: parsed.oldPrice,
          availability: parsed.availability,
          source: priceSource,
        });
      }

      if (parsed.currentPrice != null && parsed.parserStatus !== 'failed') {
        const transition: PriceTransition = {
          prev: prevSnapshot,
          next: {
            price: parsed.currentPrice,
            availability: parsed.availability,
            discountPct: parsed.discountPct,
          },
          historyMinBefore,
        };
        await processProductUpdate(updated, transition);
      }

      return { ok: true, product: updated, created: false };
    }

    const product = await productsRepo.create(parsed);
    await eventsRepo.record(product.id, 'added', { source });
    if (parsed.currentPrice != null && parsed.parserStatus !== 'failed') {
      await pricesRepo.record({
        productId: product.id,
        price: parsed.currentPrice,
        oldPrice: parsed.oldPrice,
        availability: parsed.availability,
        source: priceSource,
      });

      const transition: PriceTransition = {
        prev: null,
        next: {
          price: parsed.currentPrice,
          availability: parsed.availability,
          discountPct: parsed.discountPct,
        },
        historyMinBefore: null,
      };
      await processProductUpdate(product, transition);
    }
    // New product → make sure scheduler queue picks it up next tick.
    void reconcileQueue().catch((err) => console.warn('[PriceWatch] reconcileQueue failed', err));
    return { ok: true, product, created: true };
  },

  'product/getByCanonical': async ({ canonicalUrl }) => {
    const product = await productsRepo.getByCanonicalUrl(canonicalUrl);
    return { product: product ?? null };
  },

  'product/getById': async ({ productId }) => {
    const product = await productsRepo.getById(productId);
    return { product: product ?? null };
  },

  'priceHistory/get': async ({ productId, since }) => {
    const points = await pricesRepo.listForProduct(productId, since != null ? { since } : {});
    const aggregates = priceHistory.compute(points);
    return { points, aggregates };
  },

  'product/list': async ({ limit, archived }) => {
    const products = await productsRepo.list({ limit, archived });
    return { products };
  },

  'product/remove': async ({ productId }) => {
    await productsRepo.remove(productId);
    await updateQueue.removeTask(productId);
    return { ok: true };
  },

  'product/refresh': async ({ productId: _productId }) => {
    // Stage 5: scheduled / manual refresh through background tab.
    return { ok: false };
  },

  'notifications/list': async ({ limit, unreadOnly }) => {
    const items = await notificationsRepo.list({ limit, unreadOnly });
    return { items };
  },

  'notifications/unreadCount': async () => {
    const count = await notificationsRepo.unreadCount();
    return { count };
  },

  'notifications/markRead': async ({ id }) => {
    await notificationsRepo.markRead(id);
    await refreshBadge();
    return { ok: true };
  },

  'notifications/markAllRead': async () => {
    await notificationsRepo.markAllRead();
    await refreshBadge();
    return { ok: true };
  },

  'notificationRules/list': async () => {
    const rules = await notificationRulesRepo.list();
    return { rules };
  },

  'notificationRules/upsert': async ({ rule }) => {
    const saved = await notificationRulesRepo.upsert(rule);
    return { rule: saved };
  },

  'notificationRules/remove': async ({ id }) => {
    await notificationRulesRepo.remove(id);
    return { ok: true };
  },

  'settings/get': async () => {
    const settings = await settingsRepo.get();
    return { settings };
  },

  'settings/update': async ({ patch }) => {
    const settings = await settingsRepo.update(patch);
    await applySettings();
    return { settings };
  },
};
