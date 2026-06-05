import type { RpcHandlerMap } from '@/shared/rpc';
import { productsRepo } from '@/data/products.repo';
import { pricesRepo } from '@/data/prices.repo';
import { eventsRepo } from '@/data/events.repo';
import { notificationsRepo } from '@/data/notifications.repo';
import { notificationRulesRepo } from '@/data/notification-rules.repo';
import { collectionsRepo } from '@/data/collections.repo';
import { parserDiagnosticsRepo } from '@/data/parser-diagnostics.repo';
import { priceHistory } from '@/services/price-history';
import { recommendation } from '@/services/recommendation';
import { stats as statsService } from '@/services/stats';
import { parserHealth } from '@/services/parser-health';
import { buildPayload, validatePayload } from '@/services/import-export';
import type { ImportSummary } from '@/services/import-export';
import {
  processProductUpdate,
  refreshBadge,
  openDashboardAtNotifications,
  openDashboardAtProduct,
} from './notifier';
import {
  applySettings,
  getSchedulerStatus,
  reconcileQueue,
  takePendingSummary,
} from './scheduler';
import { updateQueue } from './scheduler/queue';
import { execute as executeUpdate } from './scheduler/executor';
import { settingsRepo } from '@/data/settings.repo';
import { db } from '@/data/db';
import type { PricePoint, UnavailableReason } from '@/shared/types';
import type { PriceTransition } from '@/services/notifications';

/** Map an executor failure code to a `Product.unavailable.reason`, or null when
 *  the failure is transient (timeout, no network, parser bug) and shouldn't
 *  flag the product as gone. Shared between manual refresh and bulk refresh. */
export function unavailableReasonFor(executorError: string | undefined): UnavailableReason | null {
  switch (executorError) {
    case 'not_product_page':
    case 'no_price':
    case 'api_returned_null':
      return executorError;
    default:
      return null;
  }
}

export const handlers: RpcHandlerMap = {
  ping: async () => ({ ok: true, ts: Date.now() }),

  'product/add': async ({ parsed, source }) => {
    let existing = await productsRepo.getByCanonicalUrl(parsed.canonicalUrl);
    if (!existing && parsed.sku) {
      const bySku = await db().products.where({ marketplace: parsed.marketplace, sku: parsed.sku }).first();
      if (bySku) {
        existing = bySku;
        // Migrate canonicalUrl so future lookups (and popup state) hit directly.
        await db().products.update(bySku.id, { canonicalUrl: parsed.canonicalUrl });
      }
    }
    const priceSource = source === 'page' ? 'visit' : 'manual';
    // Record a diagnostic for *every* parsed outcome so the health page can show
    // a meaningful ok/partial/failed success rate, not just the failures.
    void parserDiagnosticsRepo
      .record({
        marketplace: parsed.marketplace,
        parserVersion: parsed.parserVersion,
        status: parsed.parserStatus,
        url: parsed.url,
        missingFields: parsed.missingFields ?? [],
      })
      .catch((err) => console.warn('[PriceWatch] parserDiagnostics record failed', err));
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

  'priceTrends/list': async () => {
    const allPoints = await db().pricePoints.toArray();
    const byProduct = new Map<string, PricePoint[]>();
    for (const p of allPoints) {
      const arr = byProduct.get(p.productId);
      if (arr) arr.push(p);
      else byProduct.set(p.productId, [p]);
    }
    const trends: Record<
      string,
      {
        abs: number;
        pct: number;
        firstPrice: number;
        firstAt: number;
        min: number;
        minAt: number;
        lastChangeAt: number | null;
      } | null
    > = {};
    for (const [productId, points] of byProduct) {
      if (points.length < 2) {
        trends[productId] = null;
        continue;
      }
      const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (first.price <= 0) {
        trends[productId] = null;
        continue;
      }
      // Scan once for min + last actual price-change timestamp.
      let min = sorted[0]!.price;
      let minAt = sorted[0]!.timestamp;
      let lastChangeAt: number | null = null;
      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i]!;
        if (p.price < min) {
          min = p.price;
          minAt = p.timestamp;
        }
        if (i > 0 && p.price !== sorted[i - 1]!.price) {
          lastChangeAt = p.timestamp;
        }
      }
      const abs = last.price - first.price;
      const pct = abs / first.price;
      trends[productId] = {
        abs,
        pct,
        firstPrice: first.price,
        firstAt: first.timestamp,
        min,
        minAt,
        lastChangeAt,
      };
    }
    return { trends };
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

  'product/refresh': async ({ productId }) => {
    const product = await productsRepo.getById(productId);
    if (!product) return { ok: false, reason: 'no_product' };
    // WB → JSON-API; Ozon / Yandex Market → hidden inactive tab + on-demand probe.
    const result = await executeUpdate(product.marketplace, product.url, { allowHiddenTab: true });
    if (!result.ok) {
      const reason = unavailableReasonFor(result.error);
      if (reason) await productsRepo.markUnavailable(product.id, reason);
      // Refresh produced no parsed object — log a 'failed' diagnostic so the
      // health page can attribute the failure to the right marketplace and
      // expose the executor error code as the missing-fields hint.
      void parserDiagnosticsRepo
        .record({
          marketplace: product.marketplace,
          parserVersion: product.parserVersion,
          status: 'failed',
          url: product.url,
          missingFields: result.error ? [result.error] : [],
        })
        .catch((err) => console.warn('[PriceWatch] parserDiagnostics record failed', err));
      return { ok: false, reason: 'fetch_failed', message: result.error };
    }

    // Reuse the product/add path so price-point recording + notifications fire identically.
    const persistResp = await handlers['product/add'](
      { parsed: result.parsed, source: 'manual' },
      {} as chrome.runtime.MessageSender,
    );
    if ('ok' in persistResp && persistResp.ok) {
      await productsRepo.clearUnavailable(product.id);
      return { ok: true, product: persistResp.product };
    }
    return { ok: false, reason: 'fetch_failed', message: 'persist_failed' };
  },

  'product/setFavorite': async ({ productId, favorite }) => {
    await productsRepo.setFavorite(productId, favorite);
    return { ok: true };
  },

  'product/setArchived': async ({ productId, archived }) => {
    await productsRepo.setArchived(productId, archived);
    await eventsRepo.record(productId, archived ? 'archived' : 'restored');
    return { ok: true };
  },

  'product/setTags': async ({ productId, tags }) => {
    await productsRepo.setTags(productId, tags);
    return { ok: true };
  },

  'product/setCollections': async ({ productId, collectionIds }) => {
    await productsRepo.setCollections(productId, collectionIds);
    return { ok: true };
  },

  'product/setNotes': async ({ productId, notes }) => {
    await productsRepo.setNotes(productId, notes);
    return { ok: true };
  },

  'product/setGoal': async ({ productId, goal }) => {
    await productsRepo.setGoal(productId, goal);
    await eventsRepo.record(productId, 'targetUpdated', goal ? { ...goal } : { cleared: true });
    return { ok: true };
  },

  'product/events': async ({ productId }) => {
    const events = await eventsRepo.listForProduct(productId);
    return { events };
  },

  'recommendation/get': async ({ productId }) => {
    const product = await productsRepo.getById(productId);
    const points = await pricesRepo.listForProduct(productId);
    return { recommendation: recommendation.recommend(product?.currentPrice ?? null, points) };
  },

  'collections/list': async () => {
    const collections = await collectionsRepo.list();
    return { collections };
  },

  'collections/upsert': async ({ collection }) => {
    const saved = await collectionsRepo.upsert(collection);
    return { collection: saved };
  },

  'collections/remove': async ({ id }) => {
    await collectionsRepo.remove(id);
    return { ok: true };
  },

  'stats/overview': async ({ period }) => {
    const [active, archived, allPoints, diagnostics] = await Promise.all([
      productsRepo.list({ archived: false }),
      productsRepo.list({ archived: true }),
      db().pricePoints.toArray(),
      db().parserDiagnostics.toArray(),
    ]);
    const pointsByProduct = new Map<string, PricePoint[]>();
    for (const p of allPoints) {
      const arr = pointsByProduct.get(p.productId);
      if (arr) arr.push(p);
      else pointsByProduct.set(p.productId, [p]);
    }
    const overview = statsService.computeOverview(
      { active, archived, pointsByProduct, diagnostics },
      Date.now(),
      { period: period ?? 7 },
    );
    return { overview };
  },

  'parserHealth/get': async () => {
    const diagnostics = await db().parserDiagnostics.toArray();
    const products = await productsRepo.list({ archived: false });
    const report = parserHealth.compute(diagnostics, products);
    return { report };
  },

  'data/export': async () => {
    const [products, pricePoints, events, collections, notificationRules, notifications] = await Promise.all([
      db().products.toArray(),
      db().pricePoints.toArray(),
      db().events.toArray(),
      db().collections.toArray(),
      db().notificationRules.toArray(),
      db().notifications.toArray(),
    ]);
    const payload = buildPayload({
      products,
      pricePoints,
      events,
      collections,
      notificationRules,
      notifications,
    });
    return { payload };
  },

  'data/import': async ({ payload }) => {
    const valid = validatePayload(payload);
    const summary: ImportSummary = {
      productsAdded: 0,
      productsSkipped: 0,
      pricePointsAdded: 0,
      collectionsAdded: 0,
      rulesAdded: 0,
    };
    await db().transaction(
      'rw',
      [
        db().products,
        db().pricePoints,
        db().events,
        db().collections,
        db().notificationRules,
      ],
      async () => {
        const existingProductIds = new Set((await db().products.toArray()).map((p) => p.id));
        const existingCanonicals = new Set((await db().products.toArray()).map((p) => p.canonicalUrl));
        const productsToAdd = valid.products.filter((p) => {
          if (existingProductIds.has(p.id)) return false;
          if (existingCanonicals.has(p.canonicalUrl)) {
            summary.productsSkipped += 1;
            return false;
          }
          return true;
        });
        if (productsToAdd.length > 0) {
          await db().products.bulkPut(productsToAdd);
          summary.productsAdded += productsToAdd.length;
        }
        const productIdAllow = new Set([...existingProductIds, ...productsToAdd.map((p) => p.id)]);

        const ppExisting = new Set((await db().pricePoints.toArray()).map((p) => p.id));
        const ppToAdd = valid.pricePoints.filter(
          (p) => productIdAllow.has(p.productId) && !ppExisting.has(p.id),
        );
        if (ppToAdd.length > 0) {
          await db().pricePoints.bulkPut(ppToAdd);
          summary.pricePointsAdded = ppToAdd.length;
        }

        const evExisting = new Set((await db().events.toArray()).map((e) => e.id));
        const evToAdd = valid.events.filter(
          (e) => productIdAllow.has(e.productId) && !evExisting.has(e.id),
        );
        if (evToAdd.length > 0) await db().events.bulkPut(evToAdd);

        const colExisting = new Set((await db().collections.toArray()).map((c) => c.id));
        const colToAdd = valid.collections.filter((c) => !colExisting.has(c.id));
        if (colToAdd.length > 0) {
          await db().collections.bulkPut(colToAdd);
          summary.collectionsAdded = colToAdd.length;
        }

        const ruleExisting = new Set((await db().notificationRules.toArray()).map((r) => r.id));
        const rulesToAdd = valid.notificationRules.filter((r) => !ruleExisting.has(r.id));
        if (rulesToAdd.length > 0) {
          await db().notificationRules.bulkPut(rulesToAdd);
          summary.rulesAdded = rulesToAdd.length;
        }
      },
    );
    void reconcileQueue().catch(() => undefined);
    return { summary };
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

  'notifications/remove': async ({ id }) => {
    await notificationsRepo.remove(id);
    await refreshBadge();
    return { ok: true };
  },

  'notifications/removeAll': async () => {
    const before = (await notificationsRepo.list({})).length;
    await notificationsRepo.removeAll();
    await refreshBadge();
    return { ok: true, removed: before };
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

  'dashboard/open': async ({ notificationId, productId }) => {
    if (productId) {
      await openDashboardAtProduct(productId);
    } else {
      await openDashboardAtNotifications(notificationId);
    }
    return { ok: true };
  },

  'scheduler/status': async () => getSchedulerStatus(),

  'scheduler/lastSummary': async () => takePendingSummary(),
};
