import { v7 as uuidv7 } from 'uuid';
import { db } from './db';
import type { Collection } from '@/shared/types';

export interface CollectionInput {
  id?: string;
  name: string;
  color?: string;
  isSystem?: boolean;
  sortOrder?: number;
}

/**
 * Stable IDs for the seeded default collections.
 * Using stable IDs makes ensureDefaults() idempotent — a second run can never
 * create duplicates because bulkPut overwrites by id.
 */
const SEED: Collection[] = [
  { id: 'seed:want-to-buy', name: 'Хочу купить', sortOrder: 10, isSystem: false, color: '#0ea5e9' },
  { id: 'seed:wait-discount', name: 'Жду скидку', sortOrder: 20, isSystem: false, color: '#f59e0b' },
  { id: 'seed:compare', name: 'Для сравнения', sortOrder: 30, isSystem: false, color: '#a855f7' },
];

export const collectionsRepo = {
  async list(): Promise<Collection[]> {
    const all = await db().collections.toArray();
    return all.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
  },

  async getById(id: string): Promise<Collection | undefined> {
    return db().collections.get(id);
  },

  async upsert(input: CollectionInput): Promise<Collection> {
    if (input.id) {
      const existing = await db().collections.get(input.id);
      if (existing) {
        const next: Collection = {
          ...existing,
          name: input.name,
          color: input.color ?? existing.color,
          sortOrder: input.sortOrder ?? existing.sortOrder,
        };
        await db().collections.put(next);
        return next;
      }
    }
    const list = await db().collections.toArray();
    const maxOrder = list.reduce((m, c) => Math.max(m, c.sortOrder), 0);
    const next: Collection = {
      id: input.id ?? uuidv7(),
      name: input.name,
      color: input.color,
      isSystem: input.isSystem ?? false,
      sortOrder: input.sortOrder ?? maxOrder + 10,
    };
    await db().collections.put(next);
    return next;
  },

  async remove(id: string): Promise<void> {
    await db().transaction('rw', db().collections, db().products, async () => {
      const c = await db().collections.get(id);
      if (!c || c.isSystem) return;
      await db().collections.delete(id);
      // Detach the collection from any products that referenced it.
      const tagged = await db().products.where('collectionIds').equals(id).toArray();
      for (const p of tagged) {
        const next = p.collectionIds.filter((x) => x !== id);
        await db().products.update(p.id, { collectionIds: next });
      }
    });
  },

  /**
   * Idempotent on-startup hook:
   * 1. Re-write seeded defaults under stable IDs (overwrites/promotes legacy
   *    same-named rows so we don't lose user-attached products).
   * 2. Dedup any name collisions left from the random-ID era — keep the canonical
   *    seed row, reassign products' collectionIds to it, delete the orphans.
   */
  async ensureDefaults(): Promise<void> {
    await db().transaction('rw', db().collections, db().products, async () => {
      const seedNames = new Set(SEED.map((s) => s.name));

      // 1. Materialize the canonical seeds (idempotent because IDs are stable).
      await db().collections.bulkPut(SEED);

      // 2. Merge any pre-existing duplicates created by the previous random-ID seed.
      const all = await db().collections.toArray();
      const dupesByName = new Map<string, Collection[]>();
      for (const c of all) {
        if (!seedNames.has(c.name)) continue;
        const list = dupesByName.get(c.name) ?? [];
        list.push(c);
        dupesByName.set(c.name, list);
      }

      const idsToDelete: string[] = [];
      const idRemap = new Map<string, string>(); // legacy id → canonical id
      for (const [name, group] of dupesByName) {
        if (group.length <= 1) continue;
        const canonical = SEED.find((s) => s.name === name)!;
        for (const c of group) {
          if (c.id === canonical.id) continue;
          idRemap.set(c.id, canonical.id);
          idsToDelete.push(c.id);
        }
      }

      if (idsToDelete.length === 0) return;

      // Reassign products that referenced the legacy ids.
      const products = await db().products.toArray();
      for (const p of products) {
        if (!p.collectionIds.some((id) => idRemap.has(id))) continue;
        const next = Array.from(
          new Set(p.collectionIds.map((id) => idRemap.get(id) ?? id)),
        );
        await db().products.update(p.id, { collectionIds: next });
      }

      await db().collections.bulkDelete(idsToDelete);
    });
  },
};
