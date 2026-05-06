import { test, expect } from './fixtures';
import { dashboardUrl, optionsUrl } from './helpers';

test.describe('dashboard', () => {
  test('renders sidebar scopes and the empty state', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(dashboardUrl(extensionId));

    // Sidebar (now driven by i18n.t) should expose every navigation scope.
    await expect(page.getByRole('button', { name: 'Все товары' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Избранное' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Архив' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Аналитика' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Уведомления' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible();

    // Default user collections are seeded on first run.
    await expect(page.getByRole('button', { name: /Хочу купить/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Жду скидку/ })).toBeVisible();

    // Empty state for the main pane.
    await expect(
      page.getByText(
        /Пока ничего не отслеживается\. Зайдите на карточку товара Ozon \/ Wildberries \/ Я\.Маркет/,
      ),
    ).toBeVisible();
  });

  test('Аналитика opens the stats overview', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(dashboardUrl(extensionId));

    await page.getByRole('button', { name: 'Аналитика' }).click();
    await expect(page.getByRole('heading', { name: 'Аналитика' })).toBeVisible();
    await expect(page.getByText('По маркетплейсам')).toBeVisible();
    await expect(page.getByText('Потенциал экономии')).toBeVisible();
  });

  test('Настройки tab opens the unified settings page', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(dashboardUrl(extensionId));

    await page.getByRole('button', { name: 'Настройки' }).click();
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
    await expect(page.getByText('Обновлять при заходе на карточку')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Экспорт JSON' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Импорт JSON/ })).toBeVisible();
  });

  test('legacy options URL redirects into dashboard #settings', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(optionsUrl(extensionId));
    // After redirect we should be on dashboard at #settings hash with the panel rendered.
    await expect(page).toHaveURL(/dashboard\/index\.html#settings$/);
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  });
});
