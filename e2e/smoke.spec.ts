import { test, expect } from '@playwright/test';

/** Smoke tests covering the core user-visible workflows. */

test('dashboard loads with seeded demo data', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  // Demo files seed into the library → recent documents section shows cards.
  await expect(page.getByText('Recent documents')).toBeVisible();
  await expect(page.getByText('Getting Started.pdf').first()).toBeVisible({ timeout: 15_000 });
});

test('sidebar navigation reaches the file manager', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'All Files' }).click();
  await expect(page).toHaveURL(/\/files/);
  await expect(page.getByRole('heading', { name: 'All Files' })).toBeVisible();
});

test('command palette opens with the keyboard shortcut', async ({ page }) => {
  await page.goto('/dashboard');
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder(/Search files, tools and actions/)).toBeVisible();
  await page.keyboard.press('Escape');
});

test('PDF tools catalog lists the merge tool', async ({ page }) => {
  await page.goto('/tools');
  await expect(page.getByRole('heading', { name: 'PDF Tools' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Merge PDF/ })).toBeVisible();
});

test('opening a demo PDF renders the viewer', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByText('Getting Started.pdf').first().click();
  await expect(page).toHaveURL(/\/viewer\//);
  // The PDF viewer canvas should appear.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
});
