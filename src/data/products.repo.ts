import { v7 as uuidv7 } from 'uuid';
import { db } from './db';
import type { ParsedProduct, Product } from '@/shared/types';

export const productsRepo = {
  async getById(id: string): Promise<Product | undefined> {
    return db().products.get(id);
  },

  async getByCanonicalUrl(canonicalUrl: string): Promise<Product | undefined> {
    return db().products.where('canonicalUrl').equals(canonicalUrl).first();
  },

  async list(opts: { archived?: boolean; limit?: number } = {}): Promise<Product[]> {
    const { archived = false, limit } = opts;
    let q = db().products.orderBy('updatedAt').reverse();
    q = q.filter((p) => p.isArchived === archived);
    return limit ? q.limit(limit).toArray() : q.toArray();
  },

  async create(parsed: ParsedProduct): Promise<Product> {
    const now = Date.now();
    const product: Product = {
      id: uuidv7(),
      marketplace: parsed.marketplace,
      url: parsed.url,
      canonicalUrl: parsed.canonicalUrl,
      sku: parsed.sku,
      title: parsed.title,
      brand: parsed.brand,
      imageUrl: parsed.imageUrl,
      currentPrice: parsed.currentPrice,
      oldPrice: parsed.oldPrice,
      currency: 'RUB',
      discountPct: parsed.discountPct,
      availability: parsed.availability,
      priceTiers: parsed.priceTiers,
      rating: parsed.rating,
      reviewCount: parsed.reviewCount,
      description: parsed.description,
      specs: parsed.specs,
      addedAt: now,
      updatedAt: now,
      lastSeenAt: now,
      parserVersion: parsed.parserVersion,
      parserStatus: parsed.parserStatus,
      isArchived: false,
      isFavorite: false,
      tags: [],
      collectionIds: [],
    };
    await db().products.put(product);
    return product;
  },

  /**
   * Update mutable fields from a fresh parser result. Doesn't touch user-facing fields
   * (tags, collections, favorites, notes).
   */
  async updateFromParsed(productId: string, parsed: ParsedProduct, source: 'visit' | 'scheduled' | 'manual'): Promise<Product | undefined> {
    const existing = await db().products.get(productId);
    if (!existing) return undefined;
    const now = Date.now();
    const updated: Product = {
      ...existing,
      title: parsed.title || existing.title,
      brand: parsed.brand ?? existing.brand,
      imageUrl: parsed.imageUrl ?? existing.imageUrl,
      currentPrice: parsed.parserStatus === 'failed' ? existing.currentPrice : parsed.currentPrice,
      oldPrice: parsed.oldPrice,
      discountPct: parsed.discountPct,
      availability: parsed.availability,
      priceTiers: parsed.priceTiers && parsed.priceTiers.length > 0 ? parsed.priceTiers : existing.priceTiers,
      rating: parsed.rating ?? existing.rating,
      reviewCount: parsed.reviewCount ?? existing.reviewCount,
      description: parsed.description ?? existing.description,
      specs: parsed.specs && parsed.specs.length > 0 ? parsed.specs : existing.specs,
      updatedAt: source === 'visit' || source === 'scheduled' || source === 'manual' ? now : existing.updatedAt,
      lastSeenAt: now,
      parserVersion: parsed.parserVersion,
      parserStatus: parsed.parserStatus,
    };
    await db().products.put(updated);
    return updated;
  },

  async remove(productId: string): Promise<void> {
    await db().transaction('rw', db().products, db().pricePoints, db().events, async () => {
      await db().products.delete(productId);
      await db().pricePoints.where('productId').equals(productId).delete();
      await db().events.where('productId').equals(productId).delete();
    });
  },

  async setArchived(productId: string, archived: boolean): Promise<void> {
    await db().products.update(productId, { isArchived: archived, updatedAt: Date.now() });
  },

  async setFavorite(productId: string, favorite: boolean): Promise<void> {
    await db().products.update(productId, { isFavorite: favorite });
  },
};
