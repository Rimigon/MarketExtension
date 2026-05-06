import { v7 as uuidv7 } from 'uuid';
import { db } from './db';
import type { Availability, PricePoint, PriceSource } from '@/shared/types';

export const pricesRepo = {
  /**
   * Append a point to the history. Returns null if this point is identical to the last
   * recorded one (same price + availability) — we keep history sparse and only store
   * actual changes.
   */
  async record(args: {
    productId: string;
    price: number;
    oldPrice: number | null;
    availability: Availability;
    source: PriceSource;
  }): Promise<PricePoint | null> {
    const last = await this.lastForProduct(args.productId);
    if (
      last &&
      last.price === args.price &&
      last.availability === args.availability
    ) {
      return null;
    }
    const point: PricePoint = {
      id: uuidv7(),
      productId: args.productId,
      price: args.price,
      oldPrice: args.oldPrice,
      availability: args.availability,
      timestamp: Date.now(),
      source: args.source,
    };
    await db().pricePoints.put(point);
    return point;
  },

  async listForProduct(productId: string, opts: { since?: number } = {}): Promise<PricePoint[]> {
    const since = opts.since ?? 0;
    return db().pricePoints
      .where('[productId+timestamp]')
      .between([productId, since], [productId, Date.now() + 1])
      .toArray();
  },

  async lastForProduct(productId: string): Promise<PricePoint | undefined> {
    const points = await db().pricePoints
      .where('[productId+timestamp]')
      .between([productId, 0], [productId, Date.now() + 1])
      .reverse()
      .limit(1)
      .toArray();
    return points[0];
  },

  async minPriceForProduct(productId: string): Promise<number | null> {
    const points = await db().pricePoints.where('productId').equals(productId).toArray();
    if (points.length === 0) return null;
    return points.reduce((min, p) => (p.price < min ? p.price : min), points[0].price);
  },
};
