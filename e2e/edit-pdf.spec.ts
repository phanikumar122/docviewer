import { test, expect } from '@playwright/test';

/**
 * Edit PDF end-to-end: open a seeded PDF, cover existing content with a
 * whiteout box, stamp new text on top, and export. Asserting the result panel
 * appears exercises the full stamping pipeline (pdf.js mapping + pdf-lib).
 */
test('edit a PDF: whiteout + text, then export', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByText('Getting Started.pdf').first().click();
  await expect(page).toHaveURL(/\/viewer\//);

  // Jump into the PDF editor from the viewer toolbar.
  await page.getByRole('button', { name: /Edit PDF/ }).click();
  await expect(page).toHaveURL(/\/tools\/edit\//);

  const stage = page.getByTestId('pdf-stage');
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await expect(stage.locator('canvas')).toBeVisible();
  const box = await stage.boundingBox();
  if (!box) throw new Error('stage has no bounding box');

  // Whiteout: drag a cover box over part of the page.
  await page.getByTitle('Whiteout / cover').click();
  await page.mouse.move(box.x + 60, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 120, { steps: 8 });
  await page.mouse.up();

  // Text: click to drop a text box, then type over the covered area.
  await page.getByTitle('Add text').click();
  await page.mouse.click(box.x + 70, box.y + 90);
  await page.keyboard.type('Edited with DocuFlow');

  // Export and confirm a ready file is produced.
  await page.getByRole('button', { name: /Export PDF/ }).click();
  await expect(page.getByText(/file.* ready/)).toBeVisible({ timeout: 20_000 });

  // Download the result and verify it is a non-trivial PDF.
  const downloadPromise = page.waitForEvent('download');
  await page.getByTitle('Download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-edited\.pdf$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.length).toBeGreaterThan(500);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});

/**
 * Find & replace: scan the seeded PDF's real text for a known word, stage
 * cover+restamp overlays for every match, then export. This exercises the
 * text-extraction → proportional-position → annotation path end to end.
 */
test('find & replace existing PDF text, then export', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByText('Getting Started.pdf').first().click();
  await expect(page).toHaveURL(/\/viewer\//);

  await page.getByRole('button', { name: /Edit PDF/ }).click();
  await expect(page).toHaveURL(/\/tools\/edit\//);

  const stage = page.getByTestId('pdf-stage');
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await expect(stage.locator('canvas')).toBeVisible();

  // Open the Find & replace panel and swap a word the seeded PDF contains.
  await page.getByTitle('Find & replace text').click();
  // This test drives the browser cover-&-restamp fallback; the engine toggle now
  // auto-enables whenever the local engine happens to be running, so turn it off.
  const engineToggle = page.getByTestId('engine-toggle');
  await expect(engineToggle).toBeVisible();
  if (await engineToggle.isChecked()) await engineToggle.uncheck();
  await page.getByPlaceholder('e.g. phani').fill('DocuFlow');
  await page.getByPlaceholder(/phanj/).fill('DocuFlow2');
  await page.getByRole('button', { name: /Find & stage/ }).click();

  // The scan reports staged matches across one or more pages.
  await expect(page.getByText(/staged across/)).toBeVisible({ timeout: 20_000 });

  // Export and confirm a ready, non-trivial PDF is produced.
  await page.getByRole('button', { name: /Export PDF/ }).click();
  await expect(page.getByText(/file.* ready/)).toBeVisible({ timeout: 20_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTitle('Download').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks2: Buffer[] = [];
  for await (const chunk of stream) chunks2.push(chunk as Buffer);
  const out = Buffer.concat(chunks2);
  expect(out.length).toBeGreaterThan(500);
  expect(out.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
