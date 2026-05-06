import { test, expect } from './fixtures';
import { popupUrl } from './helpers';

test.describe('popup', () => {
  test('renders header and reaches the background service worker', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));

    await expect(page.getByRole('heading', { name: 'PriceWatch' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Открыть Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible();

    // Ping the background service worker through the same RPC channel the popup uses.
    const ping = await page.evaluate(
      () =>
        new Promise<unknown>((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'ping', payload: {} }, (response) => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(response);
          });
        }),
    );
    expect(ping).toMatchObject({ ok: true });
    expect(typeof (ping as { ts: number }).ts).toBe('number');
  });

  test('shows the empty state when nothing is tracked yet', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(popupUrl(extensionId));

    await expect(page.getByText('Пока нет отслеживаемых товаров.')).toBeVisible();
  });
});
