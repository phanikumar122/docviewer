import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';

/**
 * In-browser spreadsheet editor (SheetJS) — no engine needed. Build an .xlsx,
 * open it, edit a cell, save, and confirm the download is a valid workbook.
 */
test('edit a spreadsheet cell and save it back', async ({ page }) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Region', 'Q1'], ['North', '1200']]), 'Sales');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  await page.goto('/tools/edit-sheet');
  const chooser = page.waitForEvent('filechooser');
  await page.getByText(/Drag & drop/i).first().click();
  (await chooser).setFiles({ name: 'data.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(buf) });

  // Grid of inputs appears, pre-filled from the workbook.
  const cells = page.locator('table input');
  await expect(cells.first()).toHaveValue('Region', { timeout: 10_000 });

  // Edit the second-row first cell (index 2: Region, Q1, North, 1200).
  await cells.nth(2).fill('South');

  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Save \.xlsx/ }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.xlsx$/);
  const chunks: Buffer[] = [];
  for await (const c of (await d.createReadStream())) chunks.push(c as Buffer);
  const out = Buffer.concat(chunks);
  expect(out.subarray(0, 2).toString('latin1')).toBe('PK');

  // Re-read the saved workbook and confirm the edit persisted.
  const back = XLSX.read(new Uint8Array(out), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<string[]>(back.Sheets[back.SheetNames[0]], { header: 1, raw: false, defval: '' });
  expect(rows[1][0]).toBe('South');
});
