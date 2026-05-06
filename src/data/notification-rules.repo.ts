import { v7 as uuidv7 } from 'uuid';
import { db } from './db';
import type { NotificationRule } from '@/shared/types';

const DEFAULT_RULES: NotificationRule[] = [
  {
    id: 'default-drop-5',
    scope: { kind: 'global' },
    trigger: { kind: 'dropPct', value: 0.05 },
    enabled: true,
    cooldownMinutes: 60 * 12,
  },
  {
    id: 'default-back-in-stock',
    scope: { kind: 'global' },
    trigger: { kind: 'backInStock' },
    enabled: true,
    cooldownMinutes: 60 * 24,
  },
  {
    id: 'default-historical-low',
    scope: { kind: 'global' },
    trigger: { kind: 'historicalLow' },
    enabled: true,
    cooldownMinutes: 60 * 24,
  },
];

export const notificationRulesRepo = {
  async list(): Promise<NotificationRule[]> {
    return db().notificationRules.toArray();
  },

  async listForProduct(productId: string): Promise<NotificationRule[]> {
    const all = await db().notificationRules.toArray();
    return all.filter(
      (r) =>
        r.enabled &&
        (r.scope.kind === 'global' ||
          (r.scope.kind === 'product' && r.scope.productId === productId)),
    );
  },

  async upsert(rule: Omit<NotificationRule, 'id'> & { id?: string }): Promise<NotificationRule> {
    const full: NotificationRule = { ...rule, id: rule.id ?? uuidv7() };
    await db().notificationRules.put(full);
    return full;
  },

  async remove(id: string): Promise<void> {
    await db().notificationRules.delete(id);
  },

  /** Idempotent — seeds default rules only if no rules exist yet. */
  async seedDefaults(): Promise<void> {
    const count = await db().notificationRules.count();
    if (count > 0) return;
    await db().notificationRules.bulkPut(DEFAULT_RULES);
  },
};
