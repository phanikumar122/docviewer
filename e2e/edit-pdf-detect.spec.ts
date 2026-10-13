import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Click-to-edit should adapt the editable text to the clicked run's own
 * appearance — family (serif/sans), weight (bold), and ink colour — recovered
 * from the font metadata and the rendered pixels. We build a PDF with known
 * runs, click each, and assert the editor reflects the detected style.
 */
async function makePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  // pdf-lib y is from the bottom; display-space baseline = 792 − y.
  page.drawText('Regular sans text sample', { x: 72, y: 700, size: 20, font: helv });
  page.drawText('Bold sans heading sample', { x: 72, y: 640, size: 20, font: helvBold });
  page.drawText('Regular serif body sample', { x: 72, y: 580, size: 20, font: times });
  page.drawText('Red sans coloured sample', { x: 72, y: 520, size: 20, font: helv, color: rgb(0.85, 0, 0) });
  return Buffer.from(await doc.save());
}

test('click-to-edit adapts to family, weight and colour', async ({ page }) => {
  const pdf = await makePdf();
  await page.goto('/tools/edit');
  const chooser = page.waitForEvent('filechooser');
  await page.getByText(/click to browse|Drag & drop/i).first().click();
  (await chooser).setFiles({ name: 'styles.pdf', mimeType: 'application/pdf', buffer: pdf });

  const stage = page.getByTestId('pdf-stage');
  await expect(stage.locator('canvas')).toBeVisible({ timeout: 20_000 });
  const box = (await stage.boundingBox())!;
  const editor = stage.locator('[contenteditable="true"]');

  const clickRow = async (displayY: number, expect_: RegExp) => {
    await stage.click({ position: { x: box.width * 0.3, y: box.height * ((displayY - 7) / 792) } });
    await expect(editor).toContainText(expect_, { timeout: 8000 });
  };
  const style = (prop: string) => editor.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

  // Regular sans → weight 400, non-serif family.
  await clickRow(92, /Regular sans/);
  expect(await style('font-weight')).toBe('400');
  expect((await style('font-family')).toLowerCase()).not.toContain('times');
  await page.keyboard.press('Escape');

  // Bold sans → weight 700 (measured from stroke thickness).
  await clickRow(152, /Bold sans/);
  expect(await style('font-weight')).toBe('700');
  await page.keyboard.press('Escape');

  // Regular serif → serif/Times family.
  await clickRow(212, /Regular serif/);
  expect((await style('font-family')).toLowerCase()).toMatch(/times|serif/);
  await page.keyboard.press('Escape');

  // Red text → reddish ink colour sampled from the page.
  await clickRow(272, /Red sans/);
  const m = (await style('color')).match(/\d+/g)!.map(Number);
  expect(m[0]).toBeGreaterThan(150);
  expect(m[1]).toBeLessThan(90);
  expect(m[2]).toBeLessThan(90);
});
