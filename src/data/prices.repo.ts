import { v7 as uuidv7 } from 'uuid';
import { db } from './db';
import type { Availability, PricePoint, PriceSource } from '@/shared/types';

export const pricesRepo = {
  async record(args: {
    productId: string;
    price: number;
    oldPrice: number | null;
    availability: Availability;
    source: PriceSource;
  }): Promise<PricePoint> {
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
};
