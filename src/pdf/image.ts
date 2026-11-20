/** Decode an embedded image XObject to PNG (or pass JPEG/JPEG 2000 through). */
import { PDFArray, PDFContext, PDFDict, PDFName, PDFObject, PDFRawStream } from '@cantoo/pdf-lib';
import type { ImageResult } from '../shared/types';
import { decodeStreamSync } from './content/elements';
import { latin1ToBytes } from './content/tokenizer';
import { deflate, inflate } from './flate';
import { N, bytesOfString, deref, dictOf, isTrue, nameOf, numOf, numsOf } from './objects';

import { MAX_DECODE_MP } from '../shared/constants';

function filtersOf(ctx: PDFContext, d: PDFDict): { fs: string[]; ps: (PDFDict | null)[] } {
  const f = deref(ctx, d.get(N('Filter')));
  const p = deref(ctx, d.get(N('DecodeParms')));
  const fs =
    f instanceof PDFName ? [nameOf(f) ?? ''] : f instanceof PDFArray ? f.asArray().map((x) => nameOf(deref(ctx, x)) ?? '') : [];
  const ps = p instanceof PDFArray ? p.asArray().map((x) => dictOf(deref(ctx, x))) : [dictOf(p)];
  return { fs, ps };
}

/** Undo a PNG (10–15) or TIFF (2, 8-bit) predictor. */
export function unpredict(data: Uint8Array, parms: PDFDict | null | undefined): Uint8Array {
  const pred = parms ? (numOf(parms.lookup(N('Predictor'))) ?? 1) : 1;
  if (!parms || pred < 2) return data;
  const colors = numOf(parms.lookup(N('Colors'))) ?? 1;
  const bpc = numOf(parms.lookup(N('BitsPerComponent'))) ?? 8;
  const cols = numOf(parms.lookup(N('Columns'))) ?? 1;
  const rowBytes = Math.ceil((cols * colors * bpc) / 8);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  if (pred === 2) {
    if (bpc !== 8) throw new Error(`TIFF predictor with ${bpc}-bit samples is not supported`);
    const out = new Uint8Array(data);
    for (let r = 0; r * rowBytes < out.length; r++) {
      const o = r * rowBytes;
      for (let x = bpp; x < rowBytes; x++) out[o + x] = (out[o + x]! + out[o + x - bpp]!) & 0xff;
    }
    return out;
  }
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowBytes + 1)];
    const si = r * (rowBytes + 1) + 1;
    const o = r * rowBytes;
    const po = o - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = data[si + x]!;
      const left = x >= bpp ? out[o + x - bpp]! : 0;
      const up = r > 0 ? out[po + x]! : 0;
      const ul = r > 0 && x >= bpp ? out[po + x - bpp]! : 0;
      let v: number;
      switch (ft) {
        case 1: v = raw + left; break;
        case 2: v = raw + up; break;
        case 3: v = raw + ((left + up) >> 1); break;
        case 4: {
          const pp = left + up - ul;
          const pa = Math.abs(pp - left);
          const pb = Math.abs(pp - up);
          const pc = Math.abs(pp - ul);
          v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul);
          break;
        }
        default: v = raw;
      }
      out[o + x] = v & 0xff;
    }
  }
  return out;
}

export async function decodeStream(ctx: PDFContext, st: PDFRawStream): Promise<Uint8Array> {
  const { fs, ps } = filtersOf(ctx, st.dict);
  if (!fs.length) return st.contents;
  if (fs.length === 1 && fs[0] === 'FlateDecode') return unpredict(await inflate(st.contents), ps[0]);
  return decodeStreamSync(st);
}

type CS =
  | { type: 'gray' | 'rgb' | 'cmyk'; n: number; icc?: Uint8Array | null }
  | { type: 'indexed'; n: 1; base: Exclude<CS, { type: 'indexed' } | { type: 'unsupported' }>; hival: number; lookup: Uint8Array }
  | { type: 'unsupported'; why: string };

async function resolveCS(ctx: PDFContext, csIn: PDFObject | undefined, depth: number): Promise<CS> {
  const cs = deref(ctx, csIn);
  if (depth > 4) return { type: 'unsupported', why: 'nested colour space' };
  if (cs instanceof PDFName) {
    const n = nameOf(cs);
    if (n === 'DeviceGray' || n === 'CalGray' || n === 'G') return { type: 'gray', n: 1 };
    if (n === 'DeviceRGB' || n === 'CalRGB' || n === 'RGB') return { type: 'rgb', n: 3 };
    if (n === 'DeviceCMYK' || n === 'CMYK') return { type: 'cmyk', n: 4 };
    return { type: 'unsupported', why: n ?? '?' };
  }
  if (cs instanceof PDFArray && cs.size()) {
    const fam = nameOf(cs.get(0));
    if (fam === 'ICCBased') {
      const st = deref(ctx, cs.get(1));
      if (!(st instanceof PDFRawStream)) return { type: 'unsupported', why: 'ICC profile' };
      const n = numOf(st.dict.lookup(N('N'))) ?? 3;
      let icc: Uint8Array | null = null;
      try {
        icc = await decodeStream(ctx, st);
      } catch {
        icc = null;
      }
      if (n === 1) return { type: 'gray', n, icc };
      if (n === 3) return { type: 'rgb', n, icc };
      if (n === 4) return { type: 'cmyk', n, icc: null };
      return { type: 'unsupported', why: `ICC with ${n} channels` };
    }
    if (fam === 'CalRGB') return { type: 'rgb', n: 3 };
    if (fam === 'CalGray') return { type: 'gray', n: 1 };
    if (fam === 'Indexed' || fam === 'I') {
      const base = await resolveCS(ctx, cs.get(1), depth + 1);
      const hival = numOf(deref(ctx, cs.get(2))) ?? 0;
      const lk = deref(ctx, cs.get(3));
      const lookup = lk instanceof PDFRawStream ? await decodeStream(ctx, lk) : bytesOfString(lk);
      if (base.type === 'unsupported' || base.type === 'indexed' || !lookup) return { type: 'unsupported', why: 'Indexed base' };
      return { type: 'indexed', n: 1, base, hival, lookup };
    }
    return { type: 'unsupported', why: fam ?? '?' };
  }
  return { type: 'unsupported', why: 'missing colour space' };
}

/** Unpack samples to one byte each (16-bit keeps the high byte; <8-bit keeps raw values). */
export function unpack(data: Uint8Array, w: number, h: number, comps: number, bpc: number): Uint8Array {
  const n = w * h * comps;
  if (bpc === 8) {
    if (data.length >= n) return data;
    const o = new Uint8Array(n);
    o.set(data.subarray(0, n));
    return o;
  }
  const out = new Uint8Array(n);
  const rowBytes = Math.ceil((w * comps * bpc) / 8);
  for (let y = 0; y < h; y++) {
    const ro = y * rowBytes;
    for (let x = 0; x < w * comps; x++) {
      let v: number;
      if (bpc === 16) v = data[ro + x * 2] ?? 0;
      else {
        const bit = x * bpc;
        const byte = data[ro + (bit >> 3)] ?? 0;
        v = (byte >> (8 - bpc - (bit & 7))) & ((1 << bpc) - 1);
      }
      out[y * w * comps + x] = v;
    }
  }
  return out;
}

async function decodeGrayChannel(ctx: PDFContext, st: PDFRawStream, w: number, h: number, stencil: boolean): Promise<Uint8Array> {
  const d = st.dict;
  const sw = numOf(d.lookup(N('Width'))) ?? w;
  const sh = numOf(d.lookup(N('Height'))) ?? h;
  const bpc = stencil ? 1 : (numOf(d.lookup(N('BitsPerComponent'))) ?? 8);
  const raw = unpack(await decodeStream(ctx, st), sw, sh, 1, bpc);
  const max = (1 << Math.min(bpc, 8)) - 1;
  const decode = numsOf(ctx, d.get(N('Decode')));
  const inv = !!decode && decode[0]! > decode[1]!;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / w));
      const v = Math.round(((raw[sy * sw + sx] ?? 0) * 255) / max);
      out[y * w + x] = inv ? 255 - v : v;
    }
  }
  return out;
}

// ---------------------------------------------------------------- PNG encoder
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = latin1ToBytes(type);
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(t, 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32([t, data]));
  return out;
}

/** 8-bit PNG. channels: 1 gray, 2 gray+alpha, 3 RGB, 4 RGBA. Optional ICC profile (iCCP). */
export async function encodePng(w: number, h: number, channels: 1 | 2 | 3 | 4, pixels: Uint8Array, icc?: Uint8Array | null): Promise<Uint8Array> {
  const colorType = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
  const stride = w * channels;
  const filtered = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    const s = y * stride;
    filtered[o] = 2; // "Up" filter
    if (y === 0) filtered.set(pixels.subarray(s, s + stride), o + 1);
    else for (let x = 0; x < stride; x++) filtered[o + 1 + x] = (pixels[s + x]! - pixels[s - stride + x]!) & 0xff;
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (icc && icc.length) {
    const z = await deflate(icc);
    const name = latin1ToBytes('ICC profile');
    const d = new Uint8Array(name.length + 2 + z.length);
    d.set(name, 0);
    d.set(z, name.length + 2);
    parts.push(chunk('iCCP', d));
  }
  parts.push(chunk('IDAT', await deflate(filtered)), chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const cmykToRgb = (c: number, m: number, y: number, k: number): [number, number, number] => [
  255 * (1 - c) * (1 - k),
  255 * (1 - m) * (1 - k),
  255 * (1 - y) * (1 - k),
];

export async function decodeImage(ctx: PDFContext, st: PDFRawStream, name: string): Promise<ImageResult> {
  const d = st.dict;
  const w = numOf(d.lookup(N('Width'))) ?? 0;
  const h = numOf(d.lookup(N('Height'))) ?? 0;
  if ((w * h) / 1e6 > MAX_DECODE_MP)
    throw new Error(`The image is ${Math.round((w * h) / 1e6)} MP. The browser limit is ${MAX_DECODE_MP} MP. Use the PNG download.`);
  const { fs } = filtersOf(ctx, d);
  const hasAlpha = d.has(N('SMask')) || !!dictOf(deref(ctx, d.get(N('Mask'))));
  const last = fs[fs.length - 1];
  if ((last === 'DCTDecode' || last === 'JPXDecode') && fs.length === 1 && !hasAlpha) {
    return {
      bytes: st.contents.slice(), ext: last === 'DCTDecode' ? 'jpg' : 'jp2', width: w, height: h, name,
      note: `The tool saved the embedded ${last === 'DCTDecode' ? 'JPEG' : 'JPEG 2000'} image without changes.`,
    };
  }
  if (last === 'DCTDecode' || last === 'JPXDecode' || last === 'JBIG2Decode' || last === 'CCITTFaxDecode')
    throw new Error(`The tool cannot read ${last} images with masks. Use the PNG download.`);

  const stencil = isTrue(d.lookup(N('ImageMask')));
  const bpc = stencil ? 1 : (numOf(d.lookup(N('BitsPerComponent'))) ?? 8);
  const cs: CS = stencil ? { type: 'gray', n: 1 } : await resolveCS(ctx, d.get(N('ColorSpace')), 0);
  if (cs.type === 'unsupported') throw new Error(`The tool cannot save the original of an image in colour space ${cs.why}. Use the PNG download.`);
  const comps = cs.type === 'indexed' ? 1 : cs.n;
  const samples = unpack(await decodeStream(ctx, st), w, h, comps, bpc);
  const max = (1 << Math.min(bpc, 8)) - 1;
  const decode = numsOf(ctx, d.get(N('Decode')));
  const invert = !!decode && decode[0]! > decode[1]!;
  const scale = (v: number) => (bpc === 8 ? v : Math.round((v * 255) / max));
  const outGray = cs.type === 'gray' || (cs.type === 'indexed' && cs.base.type === 'gray');
  const oc = outGray ? 1 : 3;
  const px = new Uint8Array(w * h * oc);
  const notes: string[] = [];

  if (cs.type === 'indexed') {
    const bn = cs.base.n;
    const lk = cs.lookup;
    for (let i = 0; i < w * h; i++) {
      const idx = Math.min(samples[i]!, cs.hival) * bn;
      if (bn === 1) px[i] = lk[idx] ?? 0;
      else if (bn === 3) {
        px[i * 3] = lk[idx] ?? 0;
        px[i * 3 + 1] = lk[idx + 1] ?? 0;
        px[i * 3 + 2] = lk[idx + 2] ?? 0;
      } else {
        const rgb = cmykToRgb((lk[idx] ?? 0) / 255, (lk[idx + 1] ?? 0) / 255, (lk[idx + 2] ?? 0) / 255, (lk[idx + 3] ?? 0) / 255);
        px.set(rgb, i * 3);
      }
    }
    if (cs.base.type === 'cmyk') notes.push('The tool converted CMYK to RGB with a simple formula, not with an ICC profile.');
  } else if (cs.type === 'gray') {
    for (let i = 0; i < w * h; i++) {
      const v = scale(samples[i]!);
      px[i] = stencil ? 0 : invert ? 255 - v : v; // a stencil mask paints in the fill colour; shown black
    }
  } else if (cs.type === 'rgb') {
    if (bpc === 8) px.set(samples.subarray(0, w * h * 3));
    else for (let i = 0; i < w * h * 3; i++) px[i] = scale(samples[i]!);
  } else {
    for (let i = 0; i < w * h; i++) {
      let c = scale(samples[i * 4]!) / 255;
      let m = scale(samples[i * 4 + 1]!) / 255;
      let y = scale(samples[i * 4 + 2]!) / 255;
      let k = scale(samples[i * 4 + 3]!) / 255;
      if (invert) [c, m, y, k] = [1 - c, 1 - m, 1 - y, 1 - k];
      px.set(cmykToRgb(c, m, y, k), i * 3);
    }
    notes.push('The tool converted CMYK to RGB with a simple formula, not with an ICC profile.');
  }

  let alpha: Uint8Array | null = null;
  if (stencil) {
    // with the default Decode [0 1], sample 0 is painted
    alpha = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = ((samples[i] ? 1 : 0) ^ (invert ? 1 : 0)) ? 0 : 255;
  }
  const smask = deref(ctx, d.get(N('SMask')));
  if (smask instanceof PDFRawStream) alpha = await decodeGrayChannel(ctx, smask, w, h, false);
  const mask = deref(ctx, d.get(N('Mask')));
  if (mask instanceof PDFRawStream) {
    const m = await decodeGrayChannel(ctx, mask, w, h, true); // 255 = masked out
    alpha = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = 255 - m[i]!;
  } else if (mask instanceof PDFArray) notes.push('The tool ignored the colour-key mask.');

  let channels: 1 | 2 | 3 | 4 = oc;
  let pixels = px;
  if (alpha) {
    channels = (oc + 1) as 2 | 4;
    pixels = new Uint8Array(w * h * channels);
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < oc; c++) pixels[i * channels + c] = px[i * oc + c]!;
      pixels[i * channels + oc] = alpha[i]!;
    }
  }
  const icc = cs.type === 'indexed' ? (cs.base.icc ?? null) : (cs.icc ?? null);
  const bytes = await encodePng(w, h, channels, pixels, icc);
  return {
    bytes, ext: 'png', width: w, height: h, name,
    note: `Decoded ${w}×${h} px.${alpha ? ' Transparency kept.' : ''}${icc ? ' ICC profile included.' : ''}${notes.length ? ' ' + notes.join(' ') : ''}`,
  };
}
