import { notificationsRepo } from '@/data/notifications.repo';
import { notificationRulesRepo } from '@/data/notification-rules.repo';
import { eventsRepo } from '@/data/events.repo';
import { notificationsService, type PriceTransition } from '@/services/notifications';
import type { Product } from '@/shared/types';

const BADGE_BG = '#dc2626';
const NOTIFICATION_PREFIX = 'pricewatch:';

/**
 * Evaluate notification rules for a product update, persist matching notifications,
 * surface them via chrome.notifications and refresh the action badge. Cooldown is
 * checked per (rule, product). Safe to call from inside an RPC handler — failures
 * are swallowed (notifications are best-effort).
 */
export async function processProductUpdate(
  product: Product,
  transition: PriceTransition,
): Promise<void> {
  try {
    const rules = await notificationRulesRepo.listForProduct(product.id);
    if (rules.length === 0) return;
    const matches = notificationsService.evaluate(product, transition, rules);
    if (matches.length === 0) return;
    const now = Date.now();
    for (const m of matches) {
      const lastFired = await notificationsRepo.lastFiredAt(product.id, m.rule.id);
      if (lastFired != null && now - lastFired < m.rule.cooldownMinutes * 60 * 1000) continue;
      const note = await notificationsRepo.record({
        productId: product.id,
        ruleId: m.rule.id,
        title: m.title,
        body: m.body,
      });
      await eventsRepo.record(product.id, eventTypeForRule(m.rule.trigger.kind), {
        ruleId: m.rule.id,
        notificationId: note.id,
      });
      void surfaceChromeNotification(note.id, m.title, m.body, product);
    }
    await refreshBadge();
  } catch (err) {
    console.warn('[PriceWatch] processProductUpdate failed', err);
  }
}

export async function refreshBadge(): Promise<void> {
  const count = await notificationsRepo.unreadCount();
  if (typeof chrome === 'undefined' || !chrome.action) return;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_BG });
}

function surfaceChromeNotification(id: string, title: string, body: string, product: Product): void {
  if (typeof chrome === 'undefined' || !chrome.notifications) return;
  const iconUrl = product.imageUrl ?? chrome.runtime.getURL('public/icons/icon-128.png');
  chrome.notifications.create(
    `${NOTIFICATION_PREFIX}${id}`,
    {
      type: 'basic',
      title,
      message: body,
      iconUrl,
      priority: 1,
    },
    () => {
      // chrome.runtime.lastError может быть, если иконка кросс-доменная и ChromeNotifications не смогли её загрузить.
      const err = chrome.runtime.lastError;
      if (err) {
        // Fallback to bundled icon.
        chrome.notifications.create(`${NOTIFICATION_PREFIX}${id}`, {
          type: 'basic',
          title,
          message: body,
          iconUrl: chrome.runtime.getURL('public/icons/icon-128.png'),
          priority: 1,
        });
      }
    },
  );
}

function eventTypeForRule(kind: string): import('@/shared/types').ProductEventType {
  switch (kind) {
    case 'priceBelow':
    case 'dropPct':
    case 'dropAbs':
    case 'historicalLow':
      return 'priceChanged';
    case 'discountAppeared':
      return 'discountAppeared';
    case 'backInStock':
      return 'backInStock';
    case 'sellerChanged':
      return 'sellerChanged';
    default:
      return 'priceChanged';
  }
}

/**
 * Wire chrome.notifications click to open the dashboard, scrolled to the
 * notification's product. Idempotent — safe to call once at SW boot.
 */
export function registerNotificationClick(): void {
  if (typeof chrome === 'undefined' || !chrome.notifications?.onClicked) return;
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
    const dashUrl = chrome.runtime.getURL('src/dashboard/index.html');
    chrome.tabs.create({ url: dashUrl });
    chrome.notifications.clear(notificationId);
  });
}
