import { test, expect } from '@playwright/test';

/**
 * Server-engine find & replace, end to end through the UI. The engine
 * (server/app.py) is started once by global setup; this test skips cleanly when
 * it isn't running (no server/.venv).
 */
const ENGINE_URL = 'http://127.0.0.1:8787';

test('server engine: true in-place find & replace', async ({ page }) => {
  // Skip cleanly when the optional engine isn't available.
  let healthy = false;
  try {
    healthy = (await (await fetch(`${ENGINE_URL}/api/health`)).json())?.ok === true;
  } catch {
    healthy = false;
  }
  test.skip(!healthy, 'Local PDF engine not running (server/.venv missing).');

  await page.goto('/dashboard');
  await page.getByText('Getting Started.pdf').first().click();
  await expect(page).toHaveURL(/\/viewer\//);
  await page.getByRole('button', { name: /Edit PDF/ }).click();
  await expect(page).toHaveURL(/\/tools\/edit\//);

  const stage = page.getByTestId('pdf-stage');
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await expect(stage.locator('canvas')).toBeVisible();

  await page.getByTitle('Find & replace text').click();
  await page.getByPlaceholder('e.g. phani').fill('DocuFlow');
  await page.getByPlaceholder(/phanj/).fill('Globex');

  // Switch to the server engine; the status should resolve to running.
  await page.getByTestId('engine-toggle').check();
  await expect(page.getByText('running')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: /Replace in document/ }).click();

  // The engine reports matches replaced and the edited PDF re-opens.
  await expect(page.getByText(/replaced across/)).toBeVisible({ timeout: 20_000 });

  // Download the server-edited result and confirm it is a real PDF.
  const downloadPromise = page.waitForEvent('download');
  await page.getByTitle('Download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-replaced\.pdf$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.length).toBeGreaterThan(500);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
