import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { buildTree } from '../../src/pdf/content/elements';
import { PdfSession } from '../../src/pdf/session';
import { buildArtboardsDoc, buildElementsDoc } from './fixtures';

const has = (bytes: Uint8Array, s: string) => Buffer.from(bytes).includes(Buffer.from(s, 'latin1'));

describe('artboard export', async () => {
  const src = await buildArtboardsDoc();
  const session = new PdfSession();
  const info = await session.open(src, 'synthetic.ai');

  it('reports pages, UserUnit and the huge page', () => {
    if (info.error) throw new Error(info.error);
    expect(info.pages.map((p) => [p.wPt, p.hPt, p.userUnit])).toEqual([[100, 200, 10], [300, 150, 10], [400, 400, 10]]);
    expect(info.pages.map((p) => p.status)).toEqual(['vector', 'vector', 'huge']);
    expect(info.isIllustrator).toBe(true);
  });

  it('copies only the selected pages and strips Illustrator private data', async () => {
    const out = await session.exportPdf([0, 1], 'synthetic');
    expect(out.length).toBeLessThan(src.length / 10);
    expect(has(out, '/PieceInfo')).toBe(false);
    expect(has(out, '/LastModified')).toBe(false);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([[100, 200], [300, 150]]);
    for (const p of doc.getPages()) expect((p.node.get(PDFName.of('UserUnit')) as PDFNumber).asNumber()).toBe(10);
    expect(has(out, '/Subtype /Image')).toBe(false); // the big image on page 3 is gone
  });

  it('rejects files that are not PDF and old .ai files', async () => {
    const s = new PdfSession();
    expect(await s.open(new TextEncoder().encode('%!PS-Adobe-3.0\n'), 'old.ai')).toEqual({ error: 'no-pdf-compat' });
    expect(await s.open(new TextEncoder().encode('hello'), 'x.pdf')).toEqual({ error: 'not-pdf' });
  });
});

describe('element export', async () => {
  const { bytes } = await buildElementsDoc({ userUnit: 10, pieceInfo: true });
  const session = new PdfSession();
  await session.open(bytes, 'elements.pdf');
  const top = session.tree(0).root.children!;

  const contentOf = (doc: PDFDocument): string =>
    Buffer.from(decodePDFRawStream(doc.context.lookup(doc.getPages()[0]!.node.get(PDFName.of('Contents'))) as PDFRawStream).decode()).toString('latin1').replace(/\s+/g, ' ');

  it('builds a page sized to the element plus margin, keeping UserUnit', async () => {
    const r = await session.elementPdf(0, [top[4]!.id], { marginMm: 2 });
    const margin = (2 * 72) / 25.4 / 10;
    expect(r.sizePt[0]).toBeCloseTo(30 + 2 * margin, 5);
    expect(r.userUnit).toBe(10);
    const doc = await PDFDocument.load(r.bytes);
    const page = doc.getPages()[0]!;
    expect(page.getWidth()).toBeCloseTo(30 + 2 * margin, 3);
    expect((page.node.get(PDFName.of('UserUnit')) as PDFNumber).asNumber()).toBe(10);
    const content = contentOf(doc);
    expect(content).toContain('30 0 0 30 160 160 cm');
    expect(content).toMatch(/\/X\d+ Do/);
    expect(has(r.bytes, '/PieceInfo')).toBe(false);
    // only the image (and its soft mask) is copied: no fonts, no form, no ExtGState
    expect(has(r.bytes, '/Font')).toBe(false);
    expect(has(r.bytes, '/Subtype /Form')).toBe(false);
  });

  it('replays the form matrix, BBox clip and form resources for an element inside a form', async () => {
    const form = top[5]!;
    const inner = form.children![0]!; // "/GS0 gs ... re f" inside the form; GS0 is the form's own ExtGState
    const r = await session.elementPdf(0, [inner.id]);
    const doc = await PDFDocument.load(r.bytes);
    const content = contentOf(doc);
    expect(content).toContain('1 0 0 1 140 10 cm');
    expect(content).toContain('0 0 50 50 re W n');
    expect(content).toMatch(/\/GS\d+ gs/);
    expect(content).toContain('5 5 10 10 re f');
    expect(content).not.toContain('20 20 10 10 re'); // the sibling block is not included
    const res = doc.getPages()[0]!.node.lookup(PDFName.of('Resources'));
    expect(String(res)).toContain('/ExtGState');
    expect(String(res)).not.toContain('/XObject');
  });

  it('keeps paint order and drops descendants of selected elements', async () => {
    const r = await session.elementPdf(0, [top[5]!.children![1]!.id, top[0]!.id, top[5]!.id]);
    expect(r.count).toBe(2);
    const content = contentOf(await PDFDocument.load(r.bytes));
    expect(content.indexOf('0 0 10 20 re f')).toBeLessThan(content.indexOf('Do'));
  });

  it('exports every top-level element to the same drawing as the page', async () => {
    const tree = buildTree(await PDFDocument.load(bytes), 0);
    const r = await session.elementPdf(0, tree.root.children!.map((n) => n.id), { marginMm: 0 });
    const content = contentOf(await PDFDocument.load(r.bytes));
    for (const s of ['0 0 10 20 re f', '10 10 m', '/X', 'BT', 'Tj', 'ET']) expect(content).toContain(s);
  });
});
