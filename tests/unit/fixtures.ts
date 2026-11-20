/** Small synthetic PDFs, built in memory. No client files are used in unit tests. */
import { deflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';

export const enc = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'latin1'));

export function stream(doc: PDFDocument, dict: Record<string, unknown>, data: Uint8Array, compress = true): PDFRef {
  const body = compress ? new Uint8Array(deflateSync(data)) : data;
  const d = doc.context.obj({ ...(compress ? { Filter: 'FlateDecode' } : {}), ...dict } as never) as unknown as PDFDict;
  return doc.context.register(PDFRawStream.of(d, body));
}

/** An RGB image, w×h, with a gray soft mask. Pixel (x, y) = [x*10, y*10, 100], alpha = 255 - x*20. */
export function addImage(doc: PDFDocument, w = 4, h = 3): PDFRef {
  const rgb = new Uint8Array(w * h * 3);
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      rgb.set([x * 10, y * 10, 100], (y * w + x) * 3);
      a[y * w + x] = 255 - x * 20;
    }
  const smask = stream(doc, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }, a);
  return stream(doc, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, SMask: smask }, rgb);
}

/** An indexed image with a 2-entry RGB palette: left half red, right half blue. */
export function addIndexedImage(doc: PDFDocument, w = 4, h = 2): PDFRef {
  const idx = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) idx[y * w + x] = x < w / 2 ? 0 : 1;
  const palette = doc.context.obj([PDFName.of('Indexed'), PDFName.of('DeviceRGB'), 1, PDFHexString.of('ff00000000ff')]);
  return stream(doc, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, BitsPerComponent: 8, ColorSpace: palette }, idx);
}

export interface Built {
  doc: PDFDocument;
  bytes: Uint8Array;
}

/**
 * One 200×200 page whose content exercises the element model:
 *  - a translated filled rectangle,
 *  - a stroked line with width 2,
 *  - a clipped rectangle,
 *  - an image drawn at 30×30,
 *  - a form XObject (translated, with its own resources) holding one rectangle,
 *  - an invisible (ca 0) rectangle,
 *  - a text object.
 */
export async function buildElementsDoc(opts: { userUnit?: number; pieceInfo?: boolean } = {}): Promise<Built> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const img = addImage(doc);
  const gsInv = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: 0 }));
  const gsForm = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: 1 }));
  const form = stream(
    doc,
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 50], Matrix: [1, 0, 0, 1, 140, 10], Resources: { ExtGState: { GS0: gsForm } } },
    enc('/GS0 gs 0 1 0 rg 5 5 10 10 re f\nq 0 0 1 rg 20 20 10 10 re f Q\n'),
  );
  const font = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  page.node.set(
    PDFName.of('Resources'),
    doc.context.obj({ XObject: { Im0: img, Fm0: form }, ExtGState: { GS0: gsInv }, Font: { F1: font } }),
  );
  const content = [
    'q 1 0 0 1 100 100 cm 0 0 10 20 re f Q', // block: [100,100,110,120]
    '2 w 10 10 m 30 10 l S', // stroked path: [9,9,31,11]
    'q 0 0 20 20 re W n 1 0 0 rg 0 50 100 100 re f Q', // clipped to [0,0,20,20] -> paint [0,50..] is outside: empty
    'q 50 50 20 20 re W n 40 40 100 100 re f Q', // clipped: [50,50,70,70]
    'q 30 0 0 30 160 160 cm /Im0 Do Q', // image: [160,160,190,190]
    '/Fm0 Do', // form: rects at [145,15,155,25] and [160,30,170,40]
    'q /GS0 gs 0 0 200 200 re f Q', // invisible
    'BT /F1 10 Tf 20 180 Td (Hello) Tj ET', // text (approximate)
  ].join('\n');
  page.node.set(PDFName.of('Contents'), stream(doc, {}, enc(content)));
  if (opts.userUnit) page.node.set(PDFName.of('UserUnit'), doc.context.obj(opts.userUnit));
  if (opts.pieceInfo) {
    const priv = stream(doc, {}, new Uint8Array(200_000).fill(7), false);
    page.node.set(PDFName.of('PieceInfo'), doc.context.obj({ Illustrator: { Private: priv } }));
  }
  const bytes = await doc.save({ useObjectStreams: false });
  return { doc: await PDFDocument.load(bytes), bytes };
}

/** Three pages; page 3 holds a large image. Pages carry /PieceInfo with a large private stream. */
export async function buildArtboardsDoc(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const sizes: [number, number][] = [[100, 200], [300, 150], [400, 400]];
  for (const [i, [w, h]] of sizes.entries()) {
    const page = doc.addPage([w, h]);
    page.node.set(PDFName.of('UserUnit'), doc.context.obj(10));
    const priv = stream(doc, {}, new Uint8Array(100_000).fill(i), false);
    page.node.set(PDFName.of('PieceInfo'), doc.context.obj({ Illustrator: { Private: priv } }));
    page.node.set(PDFName.of('LastModified'), doc.context.obj('D:20260101'));
    let content = `0 0 1 rg 10 10 ${w - 20} ${h - 20} re f`;
    if (i === 2) {
      // 8000×7000 px, all zeros: compresses to almost nothing but counts as 56 MP
      const big = stream(doc, { Type: 'XObject', Subtype: 'Image', Width: 8000, Height: 7000, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }, new Uint8Array(8000 * 7000));
      page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Big: big } }));
      content += '\nq 400 0 0 400 0 0 cm /Big Do Q';
    }
    page.node.set(PDFName.of('Contents'), stream(doc, {}, enc(content)));
  }
  doc.catalog.set(PDFName.of('PieceInfo'), doc.context.obj({ Illustrator: { Private: stream(doc, {}, new Uint8Array(50_000), false) } }));
  doc.setCreator('Adobe Illustrator 31.0 (synthetic)');
  return doc.save({ useObjectStreams: false });
}

/** One page with the given content and optional resources. Returns the saved and loaded document. */
export async function buildContentDoc(
  content: string,
  opts: { size?: [number, number]; userUnit?: number; resources?: (doc: PDFDocument) => Record<string, unknown> } = {},
): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(opts.size ?? [600, 400]);
  if (opts.resources) page.node.set(PDFName.of('Resources'), doc.context.obj(opts.resources(doc) as never));
  page.node.set(PDFName.of('Contents'), stream(doc, {}, enc(content)));
  if (opts.userUnit) page.node.set(PDFName.of('UserUnit'), doc.context.obj(opts.userUnit));
  return PDFDocument.load(await doc.save({ useObjectStreams: false }));
}

/**
 * A pixel image "converted" to vectors: a w×h grid of 1-unit cells in five colours. Like the
 * converters do, each colour is one filled path, and runs of cells with the same colour on a
 * row are merged into one wider rectangle. With `mlRects`, rectangles use m/l/l/l/h, not `re`.
 */
export function pixelGridContent(w: number, h: number, opts: { x0?: number; y0?: number; mlRects?: boolean } = {}): string {
  const x0 = opts.x0 ?? 10;
  const y0 = opts.y0 ?? 20;
  const colour = (x: number, y: number) => (Math.floor(x / 3) * 7 + Math.floor(y / 2) * 3 + ((x * y) % 4 === 0 ? 1 : 0)) % 5;
  const paths: string[][] = [[], [], [], [], []];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; ) {
      const c = colour(x, y);
      let run = 1;
      while (x + run < w && colour(x + run, y) === c) run++;
      const [rx, ry] = [x0 + x, y0 + y];
      paths[c]!.push(
        opts.mlRects ? `${rx} ${ry} m ${rx + run} ${ry} l ${rx + run} ${ry + 1} l ${rx} ${ry + 1} l h` : `${rx} ${ry} ${run} 1 re`,
      );
      x += run;
    }
  const rgb = ['1 0 0', '0 1 0', '0 0 1', '1 1 0', '0.2 0.2 0.2'];
  return paths.map((p, c) => `${rgb[c]} rg\n${p.join('\n')}\nf`).join('\n');
}

/** Image Trace output: `n` closed curved shapes, each in its own q/cm/Q group, in `colours` flat colours. */
export function tracedContent(n: number, colours: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % colours;
    const [x, y] = [(i * 37) % 500, (i * 53) % 350];
    out.push(
      `${(c / colours).toFixed(3)} ${((c * 7) % colours / colours).toFixed(3)} 0.5 rg`,
      `q 1 0 0 1 ${x} ${y} cm 0 0 m 5 0 l 9 2 12 6 12 10 c 8 14 l 2 13 -1 8 0 4 c h f Q`,
    );
  }
  return out.join('\n');
}
