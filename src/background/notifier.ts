import { notificationsRepo } from '@/data/notifications.repo';
import { notificationRulesRepo } from '@/data/notification-rules.repo';
import { eventsRepo } from '@/data/events.repo';
import { settingsRepo } from '@/data/settings.repo';
import { notificationsService, type PriceTransition } from '@/services/notifications';
import { digestSuppressesIndividualToast } from './digest';
import type { Product, UserSettings } from '@/shared/types';

const BADGE_BG = '#dc2626';
const NOTIFICATION_PREFIX = 'pricewatch:';

/**
 * Evaluate notification rules for a product update, persist matching notifications,
 * surface them via chrome.notifications and refresh the action badge. Cooldown is
 * checked per (rule, product). Safe to call from inside an RPC handler — failures
 * are swallowed (notifications are best-effort).
 *
 * Honors three user settings:
 *   - excludedDomains: short-circuits the entire evaluation when the product's
 *     URL host matches one of the configured suffixes.
 *   - quietHours: still records the AppNotification so the user sees it later
 *     in the dashboard, but suppresses the OS-level chrome.notifications popup.
 *   - maxNotificationsPerHour: same as quiet hours — record but suppress popup.
 *     Counter is over the rolling last hour of *all* recorded notifications.
 */
export async function processProductUpdate(
  product: Product,
  transition: PriceTransition,
): Promise<void> {
  try {
    const settings = await settingsRepo.get();
    if (isExcludedDomain(product.url, settings.excludedDomains)) return;

    const rules = await notificationRulesRepo.listForProduct(product.id);
    if (rules.length === 0) return;
    const matches = notificationsService.evaluate(product, transition, rules);
    if (matches.length === 0) return;
    const now = Date.now();
    const inQuietHours = isInQuietHours(now, settings.quietHours);
    for (const m of matches) {
      const lastFired = await notificationsRepo.lastFiredAt(product.id, m.rule.id);
      if (lastFired != null && now - lastFired < m.rule.cooldownMinutes * 60 * 1000) continue;
      const note = await notificationsRepo.record({
        productId: product.id,
        ruleId: m.rule.id,
        title: m.title,
        body: m.body,
        details: {
          kind: 'rule',
          trigger: m.rule.trigger,
          cooldownMinutes: m.rule.cooldownMinutes,
          before: transition.prev,
          after: transition.next,
          historyMinBefore: transition.historyMinBefore,
          productSnapshot: {
            title: product.title,
            marketplace: product.marketplace,
            url: product.url,
            imageUrl: product.imageUrl,
            parserStatus: product.parserStatus,
          },
        },
      });
      await eventsRepo.record(product.id, eventTypeForRule(m.rule.trigger.kind), {
        ruleId: m.rule.id,
        notificationId: note.id,
      });

      // Record-but-don't-popup paths: badge still updates so the user sees
      // there's something new, but no system tray noise.
      if (inQuietHours) {
        console.info('[PriceWatch] notification suppressed (quiet hours)', m.rule.id);
        continue;
      }
      if (digestSuppressesIndividualToast(settings)) {
        // Digest mode: individual toasts are batched into a periodic summary
        // emitted by background/digest.ts. AppNotification + badge still
        // surface here so the dashboard feed and action-icon counter stay live.
        continue;
      }
      const recentCount = await notificationsRepo.countSince(now - 60 * 60 * 1000);
      if (settings.maxNotificationsPerHour > 0 && recentCount > settings.maxNotificationsPerHour) {
        console.info('[PriceWatch] notification suppressed (rate limit)', recentCount);
        continue;
      }
      void surfaceChromeNotification(note.id, m.title, m.body, product);
    }
    await refreshBadge();
  } catch (err) {
    console.warn('[PriceWatch] processProductUpdate failed', err);
  }
}

/** Match against a list of host suffixes — `ozon.ru` matches `www.ozon.ru`. */
function isExcludedDomain(url: string, excluded: string[]): boolean {
  if (!excluded || excluded.length === 0) return false;
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return excluded.some((d) => {
    const needle = d.trim().toLowerCase();
    if (!needle) return false;
    return host === needle || host.endsWith('.' + needle);
  });
}

/** Quiet hours wraparound-aware: 22:00→08:00 covers the night across midnight. */
function isInQuietHours(nowMs: number, quiet: UserSettings['quietHours']): boolean {
  if (!quiet || !quiet.from || !quiet.to) return false;
  const from = parseHHMM(quiet.from);
  const to = parseHHMM(quiet.to);
  if (from == null || to == null) return false;
  if (from === to) return false;
  const d = new Date(nowMs);
  const cur = d.getHours() * 60 + d.getMinutes();
  if (from < to) return cur >= from && cur < to;
  // Wraparound (e.g. 22:00 → 08:00): match late evening OR early morning.
  return cur >= from || cur < to;
}

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
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
  // Adding an explicit "Открыть" button — Chrome's basic notifications only
  // show a Close (×) action by default, leaving users guessing whether the
  // body is clickable. The button is wired to the same handler as onClicked.
  const opts: chrome.notifications.NotificationOptions<true> = {
    type: 'basic',
    title,
    message: body,
    iconUrl,
    priority: 1,
    buttons: [{ title: 'Открыть' }],
  };
  chrome.notifications.create(`${NOTIFICATION_PREFIX}${id}`, opts, () => {
    const err = chrome.runtime.lastError;
    if (err) {
      // Fallback to bundled icon (cross-domain image fetch may have failed).
      chrome.notifications.create(`${NOTIFICATION_PREFIX}${id}`, {
        ...opts,
        iconUrl: chrome.runtime.getURL('public/icons/icon-128.png'),
      });
    }
  });
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
 * Wire chrome.notifications click to open the dashboard at the matching
 * notification. Must be called at top-level of the SW module so the listener is
 * attached *before* MV3 wakes the SW for the click event.
 *
 * Notification id formats produced by this extension:
 *   - `pricewatch:<noteId>`                       — rule-fired notification
 *   - `pricewatch:scheduledRefresh:<timestamp>`   — bulk-refresh summary
 * Both are routed to the dashboard's «Уведомления» tab. For rule-fired we pass
 * the AppNotification id via hash (`#notifications/<noteId>`) so the detail
 * panel opens automatically; for bulk we just open the list.
 */
export function registerNotificationClick(): void {
  if (typeof chrome === 'undefined' || !chrome.notifications) return;
  const open = (notificationId: string) => {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
    const noteId = parseAppNotificationId(notificationId);
    const hash = noteId ? `#notifications/${noteId}` : '#notifications';
    void openDashboardAt(hash);
    chrome.notifications.clear(notificationId);
  };
  chrome.notifications.onClicked?.addListener(open);
  // The "Открыть" button (index 0) routes to the same dashboard view.
  chrome.notifications.onButtonClicked?.addListener((notificationId, buttonIndex) => {
    if (buttonIndex !== 0) return;
    open(notificationId);
  });
}

export function openDashboardAtNotifications(noteId?: string): Promise<void> {
  return openDashboardAt(noteId ? `#notifications/${noteId}` : '#notifications');
}

/**
 * Open the dashboard focused on a specific product. Reuses an open dashboard
 * tab when possible (mirrors openDashboardAtNotifications).
 */
export function openDashboardAtProduct(productId: string): Promise<void> {
  return openDashboardAt(`#product/${encodeURIComponent(productId)}`);
}

function parseAppNotificationId(chromeNotificationId: string): string | null {
  // Bulk-refresh summary uses a different prefix and isn't tied to a single AppNotification row.
  if (chromeNotificationId.startsWith('pricewatch:scheduledRefresh:')) return null;
  const id = chromeNotificationId.slice(NOTIFICATION_PREFIX.length);
  return id.length > 0 ? id : null;
}

async function openDashboardAt(hash: string): Promise<void> {
  const baseUrl = chrome.runtime.getURL('src/dashboard/index.html');
  const targetUrl = baseUrl + hash;
  try {
    // Reuse an open dashboard tab when there is one — focus it and update the
    // hash so the existing UI navigates instead of spawning a duplicate tab.
    const existing = await chrome.tabs.query({ url: `${baseUrl}*` });
    if (existing.length > 0 && existing[0].id != null) {
      const tab = existing[0];
      await chrome.tabs.update(tab.id!, { active: true, url: targetUrl });
      if (tab.windowId != null) {
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
        } catch {
          // window may have been closed between query and update.
        }
      }
      return;
    }
  } catch (err) {
    console.warn('[PriceWatch] dashboard tab lookup failed', err);
  }
  try {
    await chrome.tabs.create({ url: targetUrl });
  } catch (err) {
    console.warn('[PriceWatch] dashboard tab create failed', err);
  }
}
