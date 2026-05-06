import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Per-test browser context with the freshly built extension loaded.
 *
 * - Uses the full `chromium` channel (extensions don't load in `chromium-headless-shell`).
 * - Each test gets its own profile dir so storage / DB don't leak between tests.
 * - `extensionId` resolves to the MV3 service-worker host so tests can hit
 *   `chrome-extension://<id>/...` URLs for popup / dashboard.
 */
export interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

const distPath = path.resolve(__dirname, '..', 'dist');

if (!fs.existsSync(path.join(distPath, 'manifest.json'))) {
  throw new Error(
    `dist/manifest.json not found at ${distPath}. Run \`pnpm build\` before e2e tests.`,
  );
}

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricewatch-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${distPath}`,
        `--load-extension=${distPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { width: 1280, height: 800 },
    });
    await use(context);
    await context.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; Windows occasionally holds file handles after Chromium exit
    }
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const match = /chrome-extension:\/\/([^/]+)\//.exec(serviceWorker.url());
    if (!match) throw new Error(`Cannot extract extension id from ${serviceWorker.url()}`);
    await use(match[1]);
  },
});

export const expect = test.expect;
