import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { checkArtwork, classifyArtwork, gridUnit } from '../../src/pdf/artwork';
import { newScanStats, scanContent } from '../../src/pdf/content/scan';
import { PdfSession } from '../../src/pdf/session';
import { MANY_OBJECTS } from '../../src/shared/constants';
import { manyNoteText, pixelNoteText, tracedNoteText } from '../../src/ui/report';
import { buildContentDoc, enc, pixelGridContent, stream, tracedContent } from './fixtures';

const check = (doc: PDFDocument, userUnit = 1) => checkArtwork(doc, doc.getPages()[0]!, userUnit);

describe('pixel image as vectors', () => {
  it('flags a grid of 1-unit rectangles and estimates the source size', async () => {
    const doc = await buildContentDoc(pixelGridContent(120, 80));
    const a = check(doc);
    expect(a.rects).toBeGreaterThan(5000);
    expect(a.pixel).not.toBeNull();
    expect(a.pixel!.unitPt).toBe(1);
    expect([a.pixel!.srcW, a.pixel!.srcH]).toEqual([120, 80]);
    expect(a.pixel!.dpi).toBeCloseTo(72);
    expect(a.traced).toBe(false);
    expect(a.many).toBe(false);
  });

  it('applies the UserUnit to the resolution', async () => {
    const doc = await buildContentDoc(pixelGridContent(120, 80), { userUnit: 2 });
    expect(check(doc, 2).pixel!.dpi).toBeCloseTo(36);
  });

  it('finds m/l rectangles inside a scaled form XObject', async () => {
    const doc = await buildContentDoc('q 0.5 0 0 0.5 0 0 cm /Fm0 Do Q', {
      resources: (d) => ({
        XObject: { Fm0: stream(d, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1000, 1000] }, enc(pixelGridContent(140, 90, { mlRects: true }))) },
      }),
    });
    const a = check(doc);
    expect(a.forms).toBe(1);
    expect(a.rects).toBeGreaterThan(5000);
    expect(a.pixel!.unitPt).toBe(0.5);
    expect([a.pixel!.srcW, a.pixel!.srcH]).toEqual([140, 90]);
    expect(a.pixel!.dpi).toBeCloseTo(144);
  });

  it('does not flag a small grid (a QR code, for example)', async () => {
    const a = check(await buildContentDoc(pixelGridContent(40, 40)));
    expect(a.rects).toBeLessThan(5000);
    expect(a.pixel).toBeNull();
  });

  it('finds the smallest common unit', () => {
    expect(gridUnit(new Map([[100, 50], [200, 30], [300, 20]]), new Map([[100, 90], [200, 10]]))).toBe(100);
    expect(gridUnit(new Map([[137, 50], [251, 50]]), new Map([[100, 100]]))).toBeNull();
  });

  it('writes the note in Simplified Technical English with the numbers', async () => {
    const a = check(await buildContentDoc(pixelGridContent(120, 80)));
    expect(pixelNoteText(0, a)).toBe(
      `Artboard 1 is a pixel image converted into ${a.rects.toLocaleString('en-US')} small rectangles. ` +
        'The source image was about 120 × 80 px. At the real size, this is about 72 dpi. ' +
        'For full-colour print, ask the client for the original image at 150 dpi or more. ' +
        'For vector work, redraw the artwork.',
    );
  });
});

describe('traced image', () => {
  it('flags many curved flat-colour fills in a form', async () => {
    const doc = await buildContentDoc('/Fm0 Do', {
      resources: (d) => ({ XObject: { Fm0: stream(d, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 600, 400] }, enc(tracedContent(800, 30))) } }),
    });
    const a = check(doc);
    expect(a.fills).toBe(800);
    expect(a.colours).toBe(30);
    expect(a.traced).toBe(true);
    expect(a.pixel).toBeNull();
    expect(tracedNoteText(0, a)).toBe(
      'Artboard 1 looks like a traced image. It has 800 filled shapes in 30 flat colours. ' +
        'It has no strokes, text or gradients. Image tracing changes smooth gradients into flat bands of colour. ' +
        'Fine details and edges also change. Compare the artwork with the original image at full size. ' +
        'If the quality is not good enough, ask the client for the original image or the vector source file.',
    );
  });

  it('does not flag the same shapes with a gradient, text, strokes or few colours', async () => {
    const base = tracedContent(800, 30);
    const variants = [
      base + '\nq 0 0 100 100 re W n /Sh0 sh Q',
      base + '\nBT /F1 12 Tf 10 10 Td (Logo) Tj ET',
      base + '\n' + Array.from({ length: 40 }, (_, i) => `${i} 0 m ${i} 50 l S`).join('\n'),
      tracedContent(800, 6),
      tracedContent(300, 30),
    ];
    for (const v of variants) expect(check(await buildContentDoc(v)).traced).toBe(false);
  });
});

describe('normal artwork', () => {
  it('does not flag a logo with gradients, strokes, text and a few dozen paths', async () => {
    const parts: string[] = ['0.1 0.2 0.6 rg 0 0 600 400 re f'];
    for (let i = 0; i < 40; i++)
      parts.push(`q 1 0 0 1 ${i * 12} ${i * 7} cm ${i % 4 ? '0.9 0.5 0.1 rg' : '0 0 0 rg'} 0 0 m 20 0 l 30 10 30 20 20 30 c 0 30 l h f Q`);
    parts.push('2 w 0 0 0 RG 10 10 m 500 10 l S', 'q 0 0 300 300 re W n /Sh0 sh Q', 'BT /F1 24 Tf 50 350 Td (CLIENT) Tj [(A) -20 (B\\)) ] TJ ET');
    parts.push('BI /W 2 /H 1 /CS /G /BPC 8 ID \x00\xff EI');
    const a = check(await buildContentDoc(parts.join('\n')));
    expect(a.fills).toBe(41);
    expect(a.strokes).toBe(1);
    expect(a.text).toBe(1);
    expect(a.shadings).toBe(1);
    expect(a.pixel).toBeNull();
    expect(a.traced).toBe(false);
    expect(a.many).toBe(false);
  });
});

describe('many objects', () => {
  const lines = (pairs: number) => Array.from({ length: pairs }, (_, i) => `${i % 500} 0 m ${i % 500} 10 l`).join('\n') + '\nS';
  it(`flags more than ${MANY_OBJECTS} drawing operations`, () => {
    const st = newScanStats();
    scanContent(enc(lines(25_000)), st);
    expect(st.drawOps).toBe(50_001);
    expect(classifyArtwork(st, 1).many).toBe(true);
    const st2 = newScanStats();
    scanContent(enc(lines(24_999)), st2);
    expect(st2.drawOps).toBe(49_999);
    expect(classifyArtwork(st2, 1).many).toBe(false);
  });

  it('writes the note with the counts', () => {
    const st = newScanStats();
    scanContent(enc(lines(25_000)), st);
    const a = classifyArtwork(st, 1);
    const page = { index: 2, artwork: a } as never;
    expect(manyNoteText([page])).toBe(
      'Artboard 3 has 50,001 drawing operations in 0 filled paths. ' +
        'CorelDRAW can be very slow when a page has more than 50,000 objects or path nodes. ' +
        'Export this artboard as a separate PDF. In CorelDRAW, save your work frequently.',
    );
  });
});

describe('report status', () => {
  it('sets the pixel status, keeps the artboard selected by the report and records the time', async () => {
    const doc = await buildContentDoc(pixelGridContent(120, 80));
    const s = new PdfSession();
    const r = await s.open(await doc.save(), 'grid.pdf');
    if (r.error) throw new Error(r.error);
    expect(r.pages[0]!.status).toBe('pixel');
    expect(r.pages[0]!.huge).toBe(false);
    expect(r.pages[0]!.artwork!.pixel!.srcW).toBe(120);
    expect(r.timings.artwork).toBeGreaterThanOrEqual(0);
  });
});
