import { db } from './db';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';

export const settingsRepo = {
  async get(): Promise<UserSettings> {
    const row = await db().settings.get('singleton');
    if (row) return row;
    await db().settings.put(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  },

  async update(patch: Partial<Omit<UserSettings, 'id'>>): Promise<UserSettings> {
    const current = await settingsRepo.get();
    const next: UserSettings = { ...current, ...patch };
    await db().settings.put(next);
    return next;
  },
};
