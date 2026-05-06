import { v7 as uuidv7 } from 'uuid';
import { db } from './db';
import type { AppNotification, NotificationDetails } from '@/shared/types';

export const notificationsRepo = {
  async list(opts: { limit?: number; unreadOnly?: boolean } = {}): Promise<AppNotification[]> {
    const { limit, unreadOnly = false } = opts;
    let q = db().notifications.orderBy('createdAt').reverse();
    if (unreadOnly) q = q.filter((n) => n.readAt == null);
    return limit ? q.limit(limit).toArray() : q.toArray();
  },

  async unreadCount(): Promise<number> {
    return db().notifications.filter((n) => n.readAt == null).count();
  },

  async record(args: {
    productId: string;
    ruleId: string;
    title: string;
    body: string;
    details?: NotificationDetails;
  }): Promise<AppNotification> {
    const note: AppNotification = {
      id: uuidv7(),
      productId: args.productId,
      ruleId: args.ruleId,
      title: args.title,
      body: args.body,
      createdAt: Date.now(),
      ...(args.details ? { details: args.details } : {}),
    };
    await db().notifications.put(note);
    return note;
  },

  async getById(id: string): Promise<AppNotification | undefined> {
    return db().notifications.get(id);
  },

  async markRead(id: string): Promise<void> {
    await db().notifications.update(id, { readAt: Date.now() });
  },

  async markAllRead(): Promise<void> {
    const now = Date.now();
    const unread = await db().notifications.filter((n) => n.readAt == null).toArray();
    if (unread.length === 0) return;
    await db().notifications.bulkPut(unread.map((n) => ({ ...n, readAt: now })));
  },

  async remove(id: string): Promise<void> {
    await db().notifications.delete(id);
  },

  async removeAll(): Promise<void> {
    await db().notifications.clear();
  },

  async lastFiredAt(productId: string, ruleId: string): Promise<number | null> {
    const matches = await db()
      .notifications.where('productId')
      .equals(productId)
      .filter((n) => n.ruleId === ruleId)
      .reverse()
      .sortBy('createdAt');
    return matches[0]?.createdAt ?? null;
  },
};
