import type { BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURES_ROOT = path.resolve(__dirname, '..', 'tests', 'parsers', 'fixtures');

/**
 * Read a parser fixture HTML file (the same fixtures used by Vitest parser tests),
 * so e2e and unit tests stay aligned.
 */
export function loadParserFixture(marketplace: 'ozon' | 'wildberries' | 'yandex-market', name: string): string {
  const file = path.join(FIXTURES_ROOT, marketplace, `${name}.html`);
  return fs.readFileSync(file, 'utf-8');
}

/**
 * Intercept a real-looking marketplace URL and respond with a fixture HTML.
 * Lets content scripts run on a page whose origin matches `host_permissions`,
 * without touching the real marketplace.
 */
export async function mockMarketplacePage(
  context: BrowserContext,
  url: string,
  html: string,
): Promise<void> {
  await context.route(url, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    });
  });
}

export function popupUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/popup/index.html`;
}

export function dashboardUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/dashboard/index.html`;
}

export function optionsUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/options/index.html`;
}
