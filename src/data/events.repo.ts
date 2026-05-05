import { v7 as uuidv7 } from 'uuid';
import { db } from './db';
import type { ProductEvent, ProductEventType } from '@/shared/types';

export const eventsRepo = {
  async record(productId: string, type: ProductEventType, payload?: Record<string, unknown>): Promise<ProductEvent> {
    const event: ProductEvent = {
      id: uuidv7(),
      productId,
      type,
      timestamp: Date.now(),
      payload,
    };
    await db().events.put(event);
    return event;
  },

  async listForProduct(productId: string): Promise<ProductEvent[]> {
    return db().events.where('productId').equals(productId).reverse().sortBy('timestamp');
  },
};
