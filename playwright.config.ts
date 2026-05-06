import { defineConfig } from '@playwright/test';

/**
 * E2E configuration for the PriceWatch MV3 extension.
 *
 * Extension testing requires:
 *  - the *full* Chromium build (channel `chromium`, not `chromium-headless-shell`),
 *  - a persistent context launched with `--load-extension`,
 *  - a freshly built `dist/` (run `pnpm build` first; the npm script does this).
 *
 * Tests live in `e2e/` and share a custom `test` fixture in `e2e/fixtures.ts`.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  // MV3 service workers can take a moment to spin up — give the suite breathing room.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // One worker keeps the persistent contexts predictable; the suite is small.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
