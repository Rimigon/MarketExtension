import type { RpcEnvelope, RpcType } from '@/shared/rpc';
import { handlers } from './handlers';
import { notificationRulesRepo } from '@/data/notification-rules.repo';
import { collectionsRepo } from '@/data/collections.repo';
import { settingsRepo } from '@/data/settings.repo';
import { setLocale } from '@/shared/i18n';
import { refreshBadge, registerNotificationClick } from './notifier';
import { startScheduler } from './scheduler';
import { registerMaintenanceAlarm, startMaintenance } from './maintenance';
console.log('[PriceWatch] background service worker booted at', new Date().toISOString());

// Register synchronously at module init so MV3 can wake the SW from a
// notification click. Registering inside the async bootstrap() means the
// listener is attached after the click event has already fired on a cold SW.
registerNotificationClick();
registerMaintenanceAlarm();

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    await notificationRulesRepo.seedDefaults();
    await collectionsRepo.ensureDefaults();
    await refreshBadge();
    const settings = await settingsRepo.get();
    setLocale(settings.locale);
    if (settings.scheduledUpdates) {
      await startScheduler();
    }
    await startMaintenance();
  } catch (err) {
    console.warn('[PriceWatch] bootstrap failed', err);
  }
}


chrome.runtime.onInstalled.addListener((details) => {
  console.log('[PriceWatch] onInstalled', details.reason);
  void bootstrap();
});

chrome.runtime.onMessage.addListener(
  (message: RpcEnvelope<RpcType>, sender, sendResponse): boolean => {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      sendResponse({ ok: false, error: 'invalid_envelope' });
      return false;
    }
    const handler = handlers[message.type];
    if (!handler) {
      sendResponse({ ok: false, error: `no_handler:${String(message.type)}` });
      return false;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Promise.resolve(handler(message.payload as any, sender))
      .then((response) => sendResponse(response))
      .catch((err: unknown) => {
        console.error('[PriceWatch] handler error', message.type, err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true; // keep the message channel open for async response
  },
);
