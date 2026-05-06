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

  async ensureDefaults(): Promise<void> {
    const list = await db().collections.toArray();
    if (list.length > 0) return;
    const seed: Collection[] = [
      { id: uuidv7(), name: 'Хочу купить', sortOrder: 10, isSystem: false, color: '#0ea5e9' },
      { id: uuidv7(), name: 'Жду скидку', sortOrder: 20, isSystem: false, color: '#f59e0b' },
      { id: uuidv7(), name: 'Для сравнения', sortOrder: 30, isSystem: false, color: '#a855f7' },
    ];
    await db().collections.bulkPut(seed);
  },
};
