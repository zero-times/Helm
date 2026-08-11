import { expect, test } from '@playwright/test';

test('web shell connects to the server health contract', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Helm foundation ready' }),
  ).toBeVisible();
  await expect(page.getByText('API connected')).toBeVisible();
  await expect(page.getByText('Server contract 0.1.0')).toBeVisible();
});
