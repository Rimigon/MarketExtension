import type { RpcEnvelope, RpcType } from '@/shared/rpc';
import { handlers } from './handlers';
import { notificationRulesRepo } from '@/data/notification-rules.repo';
import { settingsRepo } from '@/data/settings.repo';
import { refreshBadge, registerNotificationClick } from './notifier';
import { startScheduler } from './scheduler';

console.log('[PriceWatch] background service worker booted at', new Date().toISOString());

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    await notificationRulesRepo.seedDefaults();
    await refreshBadge();
    registerNotificationClick();
    const settings = await settingsRepo.get();
    if (settings.scheduledUpdates) {
      await startScheduler();
    }
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
