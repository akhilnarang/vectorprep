/** Phase 2 checks: viewer (zoom, pan, keys) and element selection and download. */
import { expect, test } from '@playwright/test';
import {
  AI_SAMPLE, PDF_SAMPLE, clickPdf, collectProblems, has, maxGap, nodeInfo, pdfToScreen, saveDownload, startGapProbe, viewerState, waitForTree,
} from './helpers';

test('Multi-artboard .ai: logo from artboard 1, tile from artboard 7, zoom and pan', async ({ page }) => {
  test.skip(!has(AI_SAMPLE), 'sample file not available');
  const problems = collectProblems(page);
  await page.goto('/');
  await page.setInputFiles('#file', AI_SAMPLE);
  await expect(page.locator('#thumb-0 canvas')).toHaveCount(1);
  await startGapProbe(page);
  const t0 = Date.now();
  await page.click('#thumb-0');
  await waitForTree(page);
  console.log(`viewer open + elements: ${Date.now() - t0} ms, max gap ${await maxGap(page)} ms`);

  // Raster logo (artboard 1, PDF user space ~139..166 x 120..147)
  await clickPdf(page, 152, 133);
  let st = await viewerState(page);
  expect(st.selected).toHaveLength(1);
  await expect(page.locator('#v-sel-list')).toContainText('Group · 95 × 95 mm');
  await expect(page.locator('#v-dl-img')).toBeEnabled();
  await expect(page.locator('#v-dl-img')).toContainText('Im0');
  await saveDownload(page, () => page.click('#v-dl-pdf'), 'A1-logo.pdf');
  await expect(page.locator('#v-dl-status')).toContainText('99 × 99 mm');
  await saveDownload(page, () => page.click('#v-dl-img'), 'A1-logo-original.png');
  await expect(page.locator('#v-dl-status')).toContainText('Decoded 4110×4110 px');
  await saveDownload(page, () => page.click('#v-dl-png'), 'A1-logo-300dpi.png');
  await expect(page.locator('#v-dl-status')).toContainText('1,170 × 1,170 px');

  // Alt-click drills from the group into the image itself
  await clickPdf(page, 152, 133, ['Alt']);
  st = await viewerState(page);
  expect((await nodeInfo(page, st.selected[0]!)).n).toBe('Image Im0 (4110×4110 px)');

  // Wheel zoom at the logo, keys, then a sharp re-render of the visible area only
  await startGapProbe(page);
  const [cx, cy] = await pdfToScreen(page, 152, 133);
  const tz = Date.now();
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(16);
  }
  await page.keyboard.press('+');
  await page.keyboard.press('-');
  await page.waitForFunction(() => (window as unknown as { __viewer: { state(): { detail: boolean } } }).__viewer.state().detail);
  st = await viewerState(page);
  console.log(`zoom ${Math.round((st.s / st.fitS) * 100)}%: sharp render after ${Date.now() - tz} ms, max gap ${await maxGap(page)} ms`);
  expect(st.s / st.fitS).toBeGreaterThan(5);
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLCanvasElement>('#stage canvas')].map((c) => ({ id: c.id, w: c.width, h: c.height })),
  );
  for (const c of sizes) {
    // detail bitmaps cover the visible stage only; the base bitmap is capped at 4096 px
    if (c.id === 'v-base') expect(Math.max(c.w, c.h)).toBeLessThanOrEqual(4096);
    else expect(c.w * c.h).toBeLessThanOrEqual(1400 * 900);
  }
  await page.screenshot({ path: 'test-results/viewer-a1-zoomed.png' });

  // Space-drag pans
  const before = await viewerState(page);
  await page.keyboard.down(' ');
  await page.mouse.move(700, 450);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  const after = await viewerState(page);
  expect(Math.round(after.tx - before.tx)).toBe(-100);
  expect(Math.round(after.ty - before.ty)).toBe(-50);
  await page.keyboard.press('0');
  st = await viewerState(page);
  expect(st.s).toBeCloseTo(st.fitS, 5);

  // J six times: artboard 7, marquee one black tile with its logo
  for (let i = 0; i < 6; i++) await page.keyboard.press('j');
  await page.waitForFunction(() => (window as unknown as { __viewer: { state(): { index: number } } }).__viewer.state().index === 6);
  await waitForTree(page);
  await expect(page.locator('#v-title')).toHaveText('Artboard 7 of 9');
  const tile = [149.442, 477.6, 255.6, 583.7];
  const p0 = await pdfToScreen(page, tile[0]! - 1.5, tile[3]! + 1.5);
  const p1 = await pdfToScreen(page, tile[2]! + 1.5, tile[1]! - 1.5);
  await page.mouse.move(p0[0], p0[1]);
  await page.mouse.down();
  await page.mouse.move(p1[0], p1[1], { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#v-sel-list li')).toHaveCount(2);
  await expect(page.locator('#v-sel-list')).toContainText('Path · 374.3 × 374.3 mm');
  await expect(page.locator('#v-sel-list')).toContainText('Group · 140.4 × 140.4 mm');
  await page.screenshot({ path: 'test-results/viewer-a7-marquee.png' });
  await saveDownload(page, () => page.click('#v-dl-pdf'), 'A7-tile.pdf');
  await expect(page.locator('#v-dl-status')).toContainText('378.3 × 378.3 mm');
  await page.selectOption('#v-dpi', '150');
  await saveDownload(page, () => page.click('#v-dl-png'), 'A7-tile-150dpi.png');
  await expect(page.locator('#v-dl-status')).toContainText('2,234 × 2,234 px');

  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toBeHidden();
  expect(problems).toEqual([]);
});

test('Live-fonts PDF: bee via drill-down into the form', async ({ page }) => {
  test.skip(!has(PDF_SAMPLE), 'sample file not available');
  const problems = collectProblems(page);
  await page.goto('/');
  await page.setInputFiles('#file', PDF_SAMPLE);
  await expect(page.locator('#thumb-0 canvas')).toHaveCount(1);
  await page.click('#thumb-0');
  await waitForTree(page);
  const bee: [number, number] = [758, 1181];
  await clickPdf(page, ...bee);
  let st = await viewerState(page);
  let b = (await nodeInfo(page, st.selected[0]!)).b;
  expect(b[2]! - b[0]!).toBeGreaterThan(500); // the whole emblem group (it lives inside Form X7)
  await clickPdf(page, ...bee, ['Alt']);
  st = await viewerState(page);
  b = (await nodeInfo(page, st.selected[0]!)).b;
  expect(b.map(Math.round)).toEqual([678, 1118, 838, 1244]);
  await expect(page.locator('#v-sel-list')).toContainText('56.7 × 44.8 mm');
  await saveDownload(page, () => page.click('#v-dl-pdf'), 'live-fonts-bee.pdf');
  await saveDownload(page, () => page.click('#v-dl-png'), 'live-fonts-bee-300dpi.png');
  await expect(page.locator('#v-dl-status')).toContainText('717 × 576 px');
  await page.screenshot({ path: 'test-results/viewer-live-fonts-bee.png' });
  expect(problems).toEqual([]);
});
