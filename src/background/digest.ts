import type { UserSettings } from '@/shared/types';

/**
 * Digest mode is fully coupled to the scheduler — the only popup users see is
 * the post-bulk-refresh summary the scheduler already produces ("Обновлено
 * 5/8 · 2 ↓, 1 ↑"). All this module does is provide a predicate that the
 * notifier consults to suppress per-rule chrome.notifications. AppNotification
 * rows and the action-icon badge keep updating so the dashboard feed and
 * unread counter remain meaningful.
 *
 * When `scheduledUpdates` is off, `digestEnabled` is a no-op: there is no
 * periodic refresh to roll events into, so per-rule popups continue as usual.
 */
export function digestSuppressesIndividualToast(
  settings: Pick<UserSettings, 'digestEnabled' | 'scheduledUpdates'>,
): boolean {
  return settings.digestEnabled && settings.scheduledUpdates;
}
