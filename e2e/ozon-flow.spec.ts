import { test, expect } from './fixtures';
import { dashboardUrl, loadParserFixture, mockMarketplacePage } from './helpers';

const OZON_URL = 'https://www.ozon.ru/product/test-product-12345/';

test.describe('ozon golden path', () => {
  test('TrackButton injects on a product card and round-trips to the dashboard', async ({
    context,
    extensionId,
  }) => {
    // Serve our parser test fixture as the response for a real-looking ozon URL.
    // The fixture has full JSON-LD, so the parser status will be 'ok'.
    const fixture = loadParserFixture('ozon', 'with-jsonld');
    await mockMarketplacePage(context, OZON_URL, fixture);

    const page = await context.newPage();
    await page.goto(OZON_URL);

    // The Ozon content script should locate an anchor and inject the Shadow-DOM TrackButton.
    // Playwright pierces open shadow roots transparently for role/text/css selectors.
    const trackButton = page.getByRole('button', { name: /Следить за ценой/ });
    await expect(trackButton).toBeVisible({ timeout: 10_000 });

    await trackButton.click();
    await expect(page.getByText(/Отслеживается/)).toBeVisible({ timeout: 5_000 });

    // The product should now be in the dashboard.
    const dashboard = await context.newPage();
    await dashboard.goto(dashboardUrl(extensionId));

    await expect(
      dashboard.getByText('Чайник электрический Bosch TWK7203').first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('untracking removes the item from the dashboard list', async ({
    context,
    extensionId,
  }) => {
    const fixture = loadParserFixture('ozon', 'with-jsonld');
    await mockMarketplacePage(context, OZON_URL, fixture);

    const page = await context.newPage();
    await page.goto(OZON_URL);

    await page.getByRole('button', { name: /Следить за ценой/ }).click();
    await expect(page.getByText(/Отслеживается/)).toBeVisible({ timeout: 5_000 });

    // Click the inline "убрать" link.
    await page.getByRole('button', { name: 'убрать' }).click();
    await expect(page.getByRole('button', { name: /Следить за ценой/ })).toBeVisible();

    const dashboard = await context.newPage();
    await dashboard.goto(dashboardUrl(extensionId));
    // After removal the dashboard should keep its empty-state copy.
    await expect(
      dashboard.getByText(/Пока ничего не отслеживается/),
    ).toBeVisible({ timeout: 5_000 });
  });
});
