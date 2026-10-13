import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * Office + security tools end to end through the UI, backed by the local engine
 * (started once by global setup; these tests skip cleanly when it's absent).
 */
const ENGINE_URL = 'http://127.0.0.1:8787';

// Engine conversions share one Flask process; run this file's tests serially so
// parallel heavy conversions don't queue past their timeouts.
test.describe.configure({ mode: 'serial' });
// Conversions are CPU-heavy and contend with other engine-using specs.
test.beforeEach(() => test.slow());

async function enginePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Quarterly report: revenue grew eighteen percent.', { x: 60, y: 760, size: 14, font });
  page.drawText('The team shipped many features this period.', { x: 60, y: 730, size: 14, font });
  return Buffer.from(await doc.save());
}

async function ensureEngine(page: import('@playwright/test').Page): Promise<void> {
  let ok = false;
  try { ok = (await (await fetch(`${ENGINE_URL}/api/health`)).json())?.ok === true; } catch { ok = false; }
  test.skip(!ok, 'Local engine not running (server/.venv missing).');
  await expect(page.getByText('running')).toBeVisible({ timeout: 10_000 });
}

test('PDF to Word through the UI', async ({ page }) => {
  test.slow();
  await page.goto('/tools/pdf-to-word');
  await ensureEngine(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByText(/click to browse|Drag & drop/i).first().click();
  (await chooser).setFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: await enginePdf() });

  await page.getByRole('button', { name: /Convert to Word/ }).click();
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTitle('Download').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.docx$/);
  const chunks: Buffer[] = [];
  for await (const c of (await d.createReadStream())) chunks.push(c as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // .docx is a zip
  expect(bytes.length).toBeGreaterThan(1000);
});

test('Password-protect a PDF through the UI', async ({ page }) => {
  await page.goto('/tools/protect');
  await ensureEngine(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByText(/click to browse|Drag & drop/i).first().click();
  (await chooser).setFiles({ name: 'secret.pdf', mimeType: 'application/pdf', buffer: await enginePdf() });

  await page.getByPlaceholder(/strong password/).fill('hunter2!');
  await page.getByRole('button', { name: /Protect PDF/ }).click();
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTitle('Download').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/-protected\.pdf$/);
  const chunks: Buffer[] = [];
  for await (const c of (await d.createReadStream())) chunks.push(c as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // An encrypted PDF carries an /Encrypt dictionary.
  expect(bytes.toString('latin1')).toContain('/Encrypt');
});

async function convertPdfTo(page: import('@playwright/test').Page, route: string, cta: RegExp, ext: RegExp): Promise<Buffer> {
  test.slow(); // engine conversions are CPU-heavy and share one process under parallel runs
  await page.goto(route);
  await ensureEngine(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByText(/click to browse|Drag & drop/i).first().click();
  (await chooser).setFiles({ name: 'in.pdf', mimeType: 'application/pdf', buffer: await enginePdf() });
  await page.getByRole('button', { name: cta }).click();
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTitle('Download').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(ext);
  const chunks: Buffer[] = [];
  for await (const c of (await d.createReadStream())) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

test('PDF to Excel through the UI', async ({ page }) => {
  const bytes = await convertPdfTo(page, '/tools/pdf-to-excel', /Convert to Excel/, /\.xlsx$/);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // .xlsx is a zip
  expect(bytes.length).toBeGreaterThan(500);
});

test('PDF to PowerPoint through the UI', async ({ page }) => {
  const bytes = await convertPdfTo(page, '/tools/pdf-to-ppt', /Convert to PowerPoint/, /\.pptx$/);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // .pptx is a zip
  expect(bytes.length).toBeGreaterThan(1000);
});

test('Word to PDF through the UI', async ({ page }) => {
  test.slow();
  const docx = await convertPdfTo(page, '/tools/pdf-to-word', /Convert to Word/, /\.docx$/);
  expect(docx.subarray(0, 2).toString('latin1')).toBe('PK');

  await page.goto('/tools/word-to-pdf');
  await ensureEngine(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByText(/click to browse|Drag & drop/i).first().click();
  (await chooser).setFiles({ name: 'document.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx });

  await page.getByRole('button', { name: /Convert to PDF/ }).click();
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTitle('Download').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.pdf$/);
  const chunks: Buffer[] = [];
  for await (const c of (await d.createReadStream())) chunks.push(c as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});

test('PowerPoint to PDF through the UI', async ({ page }) => {
  test.slow();
  const pptx = await convertPdfTo(page, '/tools/pdf-to-ppt', /Convert to PowerPoint/, /\.pptx$/);
  expect(pptx.subarray(0, 2).toString('latin1')).toBe('PK');

  await page.goto('/tools/ppt-to-pdf');
  await ensureEngine(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByText(/click to browse|Drag & drop/i).first().click();
  (await chooser).setFiles({ name: 'deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: pptx });

  await page.getByRole('button', { name: /Convert to PDF/ }).click();
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTitle('Download').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.pdf$/);
  const chunks: Buffer[] = [];
  for await (const c of (await d.createReadStream())) chunks.push(c as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});

test('OCR a PDF through the UI', async ({ page }) => {
  const bytes = await convertPdfTo(page, '/tools/ocr', /Run OCR/, /\.pdf$/);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});

test('Reflow a paragraph in Edit PDF', async ({ page }) => {
  test.slow();
  // Build a PDF with a 3-line paragraph near the top of a 595×842 page.
  const doc = await PDFDocument.create();
  const pg = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pg.drawText('The original paragraph spans a few lines here', { x: 60, y: 760, size: 13, font });
  pg.drawText('and will be rewritten by the reflow engine so', { x: 60, y: 742, size: 13, font });
  pg.drawText('that the new text wraps inside the same box.', { x: 60, y: 724, size: 13, font });
  const pdf = Buffer.from(await doc.save());

  await page.goto('/tools/edit');
  let ok = false;
  try { ok = (await (await fetch(`${ENGINE_URL}/api/health`)).json())?.ok === true; } catch { ok = false; }
  test.skip(!ok, 'Local engine not running.');

  const chooser = page.waitForEvent('filechooser');
  await page.getByText(/Drag & drop/i).first().click();
  (await chooser).setFiles({ name: 'para.pdf', mimeType: 'application/pdf', buffer: pdf });

  const stage = page.getByTestId('pdf-stage');
  await expect(stage.locator('canvas')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Reflow/ }).click();
  // Wait until the engine is detected (the panel switches to the "click a paragraph" prompt).
  await expect(page.getByText(/Click a paragraph/i)).toBeVisible({ timeout: 10_000 });

  // Click the paragraph (display y ≈ 842−760 ≈ 82 → ~0.11 down).
  const box = (await stage.boundingBox())!;
  await stage.click({ position: { x: box.width * 0.3, y: box.height * 0.105 } });

  const ta = page.locator('textarea');
  await expect(ta).toBeVisible({ timeout: 8000 });
  await expect(ta).toHaveValue(/original paragraph/i);
  await ta.fill('A completely rewritten paragraph that the engine will wrap to fit inside the original paragraph box, proving true reflow.');
  await page.getByRole('button', { name: /Apply reflow/ }).click();
  await expect(page.getByText(/reflowed/i).first()).toBeVisible({ timeout: 20_000 });
});
