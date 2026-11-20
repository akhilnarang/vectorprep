import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * Sample files are client work and are never committed. Point SAMPLES_DIR at a folder that
 * contains them; tests that need a missing file are skipped.
 */
export const SAMPLES_DIR = resolve(process.env.SAMPLES_DIR ?? '../vectorprep-samples');
export const AI_SAMPLE = join(SAMPLES_DIR, 'sample-multi-artboard.ai');
export const PDF_SAMPLE = join(SAMPLES_DIR, 'sample-live-fonts.pdf');
export const has = (f: string): boolean => existsSync(f);

/** Downloads are written here so they can be compared with pdfinfo/pdfimages/pdftoppm afterwards. */
export const OUT = resolve(process.env.E2E_OUT ?? 'test-results/downloads');
mkdirSync(OUT, { recursive: true });

export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m: ConsoleMessage) => {
    const t = m.text();
    if (m.type() === 'error' || /Content Security Policy|Refused to/.test(t)) problems.push(`${m.type()}: ${t}`);
  });
  return problems;
}

export async function saveDownload(page: Page, trigger: () => Promise<unknown>, name?: string): Promise<string> {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), trigger()]);
  const f = join(OUT, name ?? d.suggestedFilename());
  await d.saveAs(f);
  return f;
}

type ViewerState = { index: number; s: number; tx: number; ty: number; fitS: number; selected: number[]; scope: number; hasTree: boolean; detail: boolean };

export const viewerState = (page: Page): Promise<ViewerState> =>
  page.evaluate(() => (window as unknown as { __viewer: { state(): ViewerState } }).__viewer.state());

export async function waitForTree(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __viewer: { state(): { hasTree: boolean } | null } }).__viewer.state()?.hasTree);
}

export const pdfToScreen = (page: Page, x: number, y: number): Promise<[number, number]> =>
  page.evaluate(([px, py]) => (window as unknown as { __viewer: { pdfToScreen(a: number, b: number): [number, number] } }).__viewer.pdfToScreen(px!, py!), [x, y]);

export const nodeInfo = (page: Page, id: number): Promise<{ n: string; b: number[] }> =>
  page.evaluate((i) => (window as unknown as { __viewer: { node(i: number): { n: string; b: number[] } } }).__viewer.node(i), id);

export async function clickPdf(page: Page, x: number, y: number, modifiers: ('Alt' | 'Shift')[] = []): Promise<void> {
  const [sx, sy] = await pdfToScreen(page, x, y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(sx, sy);
  for (const m of modifiers) await page.keyboard.up(m);
  await page.waitForTimeout(100);
}

/** Longest gap between 16 ms timer ticks since the last call: a main-thread responsiveness probe. */
export async function startGapProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __gi?: number };
    w.__gaps = [];
    let t = performance.now();
    clearInterval(w.__gi);
    w.__gi = window.setInterval(() => {
      const n = performance.now();
      w.__gaps.push(n - t);
      t = n;
    }, 16);
  });
}
export const maxGap = (page: Page): Promise<number> =>
  page.evaluate(() => Math.round(Math.max(0, ...(window as unknown as { __gaps: number[] }).__gaps)));
