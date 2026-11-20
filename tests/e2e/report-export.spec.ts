/** Phase 1 checks: loading, the artboard report, artboard export. */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { AI_SAMPLE, PDF_SAMPLE, collectProblems, has, maxGap, saveDownload, startGapProbe } from './helpers';

test('an .ai without PDF compatibility gets a clear message', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', {
    name: 'old.ai',
    mimeType: 'application/postscript',
    buffer: Buffer.from('%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator(R) 24.0\n%%EOF\n'),
  });
  await expect(page.locator('#status[data-kind=error]')).toHaveText(
    "This .ai file has no PDF compatibility. Ask the client to save it again with 'Create PDF Compatible File' selected.",
  );
});

test('Multi-artboard .ai: report, huge artboard unticked, exports', async ({ page }) => {
  test.skip(!has(AI_SAMPLE), 'sample file not available');
  const problems = collectProblems(page);
  await page.goto('/');
  await startGapProbe(page);
  const t0 = Date.now();
  await page.setInputFiles('#file', AI_SAMPLE);
  await expect(page.locator('#result')).toBeVisible();
  const tReport = Date.now() - t0;
  await expect(page.locator('#fmeta')).toContainText('9 pages');
  await expect(page.locator('[data-testid=artboard-card]')).toHaveCount(9);
  for (let i = 0; i < 9; i++) {
    await page.locator(`#page-${i}`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  await expect(page.locator('[data-testid=thumb] canvas')).toHaveCount(8);
  console.log(`report ${tReport} ms, all thumbnails ${Date.now() - t0} ms, max main-thread gap ${await maxGap(page)} ms`);

  const p9 = page.locator('#page-8');
  await expect(p9.locator('[data-testid=badge]')).toHaveText('Large raster: not selected');
  await expect(p9.locator('input[type=checkbox]')).not.toBeChecked();
  await expect(p9.locator('[data-testid=thumb]')).toContainText('No preview');
  await expect(p9.locator('[data-testid=card-detail]')).toContainText('34,560 × 30,960 px');
  await expect(page.locator('#page-2 [data-testid=badge]')).toHaveText('Vector');
  for (const i of [0, 1, 3, 4, 5, 6, 7]) await expect(page.locator(`#page-${i} [data-testid=badge]`).first()).toHaveText('Vector and raster');
  for (let i = 0; i < 8; i++) await expect(page.locator(`#page-${i} input[type=checkbox]`)).toBeChecked();
  await expect(page.locator('#page-0 [data-testid=card-dims]')).toContainText('1524 × 2133.6 mm');
  await expect(page.locator('#page-0 [data-testid=card-dims]')).toContainText('UserUnit 10');
  await expect(page.locator('#notes')).toContainText('Artboard 9 has raster images larger than 50 MP');
  // Normal artwork: no "fake vector" or "many objects" flags.
  for (let i = 0; i < 9; i++) await expect(page.locator(`#page-${i}`)).toHaveAttribute('data-flags', '');
  await expect(page.locator('#notes [data-testid=note]')).toHaveCount(3);
  await expect(page.locator('#page-6 [data-testid=card-artwork]')).toContainText('409 filled paths');
  await expect(page.locator('#selcount')).toHaveText('8 of 9 selected');
  await expect(page.locator('#exp-single-name')).toHaveText('sample-multi-artboard (artboards 1-8).pdf');

  const t1 = Date.now();
  const f = await saveDownload(page, () => page.click('#exp-single'));
  console.log(`export artboards 1-8: ${Date.now() - t1} ms`);
  expect(f).toMatch(/sample-multi-artboard \(artboards 1-8\)\.pdf$/);
  await expect(page.locator('#exp-status[data-kind=ok]')).toContainText('1.8 MB');
  const bytes = readFileSync(f);
  expect(bytes.length).toBeGreaterThan(1_500_000);
  expect(bytes.length).toBeLessThan(2_500_000);
  expect(bytes.includes(Buffer.from('/PieceInfo'))).toBe(false);

  const zip = await saveDownload(page, () => page.click('#exp-zip'));
  expect(zip).toMatch(/sample-multi-artboard - artboards\.zip$/);

  await page.click('[data-select=none]');
  await page.check('#page-2 input');
  await page.check('#page-6 input');
  const names: string[] = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  await page.click('#exp-each');
  await expect(page.locator('#exp-status[data-kind=ok]')).toContainText('Saved 2 PDFs');
  await page.waitForTimeout(800);
  expect(names).toEqual(['sample-multi-artboard - artboard 3.pdf', 'sample-multi-artboard - artboard 7.pdf']);
  expect(problems).toEqual([]);
});

test('Live-fonts PDF: flagged for live fonts, opened by drag and drop', async ({ page }) => {
  test.skip(!has(PDF_SAMPLE), 'sample file not available');
  const problems = collectProblems(page);
  await page.goto('/');
  // Real drag and drop onto the window (not the file picker).
  const b64 = readFileSync(PDF_SAMPLE).toString('base64');
  const dt = await page.evaluateHandle((data) => {
    const bin = atob(data);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const t = new DataTransfer();
    t.items.add(new File([u8], 'sample-live-fonts.pdf', { type: 'application/pdf' }));
    return t;
  }, b64);
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt });
  await expect(page.locator('#dropzone-overlay')).toBeVisible();
  await page.dispatchEvent('main', 'drop', { dataTransfer: dt });
  await expect(page.locator('#dropzone-overlay')).toBeHidden();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#page-0 [data-testid=badge]')).toHaveText('Live fonts');
  await expect(page.locator('#page-0 [data-testid=card-detail]')).toContainText('PetitFormalScript-Regular · Type0 · embedded');
  await expect(page.locator('#notes')).toContainText('Artboard 1 has text that is not converted to outlines');
  await expect(page.locator('#page-0')).toHaveAttribute('data-flags', '');
  await expect(page.locator('#notes [data-testid=note]')).toHaveCount(1);
  await expect(page.locator('#page-0 [data-testid=thumb] canvas')).toHaveCount(1);
  const f = await saveDownload(page, () => page.click('#exp-single'));
  expect(f).toMatch(/sample-live-fonts \(artboard 1\)\.pdf$/);
  expect(problems).toEqual([]);
});
