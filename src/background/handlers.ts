import type { RpcHandlerMap } from '@/shared/rpc';
import { productsRepo } from '@/data/products.repo';
import { pricesRepo } from '@/data/prices.repo';
import { eventsRepo } from '@/data/events.repo';

export const handlers: RpcHandlerMap = {
  ping: async () => ({ ok: true, ts: Date.now() }),

  'product/add': async ({ parsed, source }) => {
    const existing = await productsRepo.getByCanonicalUrl(parsed.canonicalUrl);
    if (existing) {
      const updated = (await productsRepo.updateFromParsed(existing.id, parsed, 'visit')) ?? existing;
      if (parsed.currentPrice != null && parsed.parserStatus !== 'failed') {
        await pricesRepo.record({
          productId: updated.id,
          price: parsed.currentPrice,
          oldPrice: parsed.oldPrice,
          availability: parsed.availability,
          source: source === 'page' ? 'visit' : 'manual',
        });
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
        source: source === 'page' ? 'visit' : 'manual',
      });
    }
    return { ok: true, product, created: true };
  },

  'product/getByCanonical': async ({ canonicalUrl }) => {
    const product = await productsRepo.getByCanonicalUrl(canonicalUrl);
    return { product: product ?? null };
  },

  'product/list': async ({ limit, archived }) => {
    const products = await productsRepo.list({ limit, archived });
    return { products };
  },

  'product/remove': async ({ productId }) => {
    await productsRepo.remove(productId);
    return { ok: true };
  },

  'product/refresh': async ({ productId: _productId }) => {
    // Stage 5: scheduled / manual refresh through background tab.
    return { ok: false };
  },
};
