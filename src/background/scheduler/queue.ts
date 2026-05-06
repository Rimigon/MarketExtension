import type { UpdateTask } from '@/services/scheduler';

const STORAGE_KEY = 'pricewatch:updateQueue';

interface QueueShape {
  tasks: UpdateTask[];
  lastRunByMarketplace: Record<string, number>;
}

const EMPTY: QueueShape = { tasks: [], lastRunByMarketplace: {} };

/**
 * Persisted update-queue, kept in `chrome.storage.session`. Session storage clears
 * when the browser process exits, which matches our model: scheduled work is
 * rebuilt from `products` table on next boot.
 */
export const updateQueue = {
  async load(): Promise<QueueShape> {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) return EMPTY;
    const raw = await chrome.storage.session.get(STORAGE_KEY);
    const value = raw[STORAGE_KEY] as QueueShape | undefined;
    if (!value || !Array.isArray(value.tasks)) return { tasks: [], lastRunByMarketplace: {} };
    return value;
  },

  async save(state: QueueShape): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) return;
    await chrome.storage.session.set({ [STORAGE_KEY]: state });
  },

  async clear(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) return;
    await chrome.storage.session.remove(STORAGE_KEY);
  },

  async upsertTask(task: UpdateTask): Promise<void> {
    const state = await updateQueue.load();
    const idx = state.tasks.findIndex((t) => t.productId === task.productId);
    if (idx >= 0) state.tasks[idx] = task;
    else state.tasks.push(task);
    await updateQueue.save(state);
  },

  async removeTask(productId: string): Promise<void> {
    const state = await updateQueue.load();
    state.tasks = state.tasks.filter((t) => t.productId !== productId);
    await updateQueue.save(state);
  },
};
