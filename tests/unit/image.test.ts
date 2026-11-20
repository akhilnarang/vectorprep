import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';
import { crc32, decodeImage, encodePng, unpredict } from '../../src/pdf/image';
import { addImage, addIndexedImage } from './fixtures';

/** Minimal PNG reader for 8-bit, filter-type-aware images (enough to check our encoder). */
function readPng(png: Uint8Array) {
  const b = Buffer.from(png);
  expect(b.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let o = 8;
  let w = 0, h = 0, ct = 0;
  const idat: Buffer[] = [];
  const chunks: string[] = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString('latin1', o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    expect(b.readUInt32BE(o + 8 + len)).toBe(crc32([new Uint8Array(b.subarray(o + 4, o + 8)), new Uint8Array(data)]));
    chunks.push(type);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]!; }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]!;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const up = y ? px[(y - 1) * stride + x]! : 0;
      const left = x >= ch ? px[y * stride + x - ch]! : 0;
      px[y * stride + x] = (f === 2 ? v + up : f === 1 ? v + left : v) & 0xff;
    }
  }
  return { w, h, ch, px, chunks };
}

describe('PNG encoder', () => {
  it('writes valid chunks and pixels', async () => {
    const px = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const png = readPng(await encodePng(2, 2, 3, px, new Uint8Array([1, 2, 3])));
    expect(png).toMatchObject({ w: 2, h: 2, ch: 3 });
    expect(png.px).toEqual(px);
    expect(png.chunks).toEqual(['IHDR', 'iCCP', 'IDAT', 'IEND']);
  });
});

describe('PNG predictor', () => {
  it('undoes Sub and Up rows', () => {
    const parms = { lookup: (n: PDFName) => PDFNumber.of(({ '/Predictor': 15, '/Colors': 1, '/BitsPerComponent': 8, '/Columns': 3 } as Record<string, number>)[n.asString()] ?? 0) };
    const data = new Uint8Array([1, 10, 1, 1, 2, 5, 5, 5]); // row0: Sub [10,11,12]; row1: Up [15,16,17]
    expect(unpredict(data, parms as never)).toEqual(new Uint8Array([10, 11, 12, 15, 16, 17]));
  });
});

describe('original image export', () => {
  it('decodes RGB + soft mask to an RGBA PNG', async () => {
    const doc = await PDFDocument.create();
    const ref = addImage(doc, 4, 3);
    const st = doc.context.lookup(ref) as PDFRawStream;
    const r = await decodeImage(doc.context, st, 'Im0');
    expect(r).toMatchObject({ ext: 'png', width: 4, height: 3 });
    const png = readPng(r.bytes);
    expect(png.ch).toBe(4);
    // pixel (x=2, y=1)
    expect([...png.px.subarray((1 * 4 + 2) * 4, (1 * 4 + 2) * 4 + 4)]).toEqual([20, 10, 100, 255 - 40]);
  });

  it('expands an indexed image through its palette', async () => {
    const doc = await PDFDocument.create();
    const st = doc.context.lookup(addIndexedImage(doc, 4, 2)) as PDFRawStream;
    const png = readPng((await decodeImage(doc.context, st, 'Im1')).bytes);
    expect(png.ch).toBe(3);
    expect([...png.px.subarray(0, 3)]).toEqual([255, 0, 0]);
    expect([...png.px.subarray(3 * 3, 3 * 3 + 3)]).toEqual([0, 0, 255]);
  });
});
