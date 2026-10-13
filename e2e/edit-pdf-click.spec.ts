import { test, expect } from '@playwright/test';

/**
 * Click-to-edit: in the Edit PDF tool, clicking directly on existing PDF text
 * should turn that text into an editable box (pre-filled with the original),
 * drop a caret in it, and let the user type over it — then export a real PDF.
 */
test('click existing PDF text to edit it in place, then export', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByText('Getting Started.pdf').first().click();
  await expect(page).toHaveURL(/\/viewer\//);
  await page.getByRole('button', { name: /Edit PDF/ }).click();
  await expect(page).toHaveURL(/\/tools\/edit\//);

  const stage = page.getByTestId('pdf-stage');
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await expect(stage.locator('canvas')).toBeVisible();

  // The title "Getting Started with DocuFlow" sits near the top-left of the
  // page (display point ≈ (120, 62) on a 595×842 page → fractions below).
  const box = (await stage.boundingBox())!;
  await stage.click({ position: { x: box.width * 0.25, y: box.height * 0.075 } });

  // A contenteditable text box appears, pre-filled with the clicked line.
  const editor = stage.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await expect(editor).toContainText(/DocuFlow/i);

  // Replace the text in place.
  await editor.selectText();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Welcome to DocuFlow Pro');
  await expect(editor).toContainText('Welcome to DocuFlow Pro');

  // Commit the edit, export, then download the baked-in result.
  await stage.click({ position: { x: box.width * 0.5, y: box.height * 0.9 } });
  await page.getByRole('button', { name: /Export PDF/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTitle('Download').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.length).toBeGreaterThan(500);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
