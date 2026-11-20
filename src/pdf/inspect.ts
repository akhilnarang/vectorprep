/** Per-page inspection for the artboard report: sizes, raster images, fonts. Never decodes streams (the artwork checks are in artwork.ts). */
import { PDFArray, PDFContext, PDFDict, PDFDocument, PDFName, PDFObject, PDFPage, PDFRef } from '@cantoo/pdf-lib';
import type { ArtworkCheck, Box, FontInfo, ImageInfo, PageReport, PageStatus } from '../shared/types';
import { N, deref, dictOf, inherited, isTrue, nameOf, numOf } from './objects';

export { HUGE_MP } from '../shared/constants';
import { HUGE_MP } from '../shared/constants';

export function colorSpaceLabel(ctx: PDFContext, csIn: PDFObject | undefined): string {
  const cs = deref(ctx, csIn);
  if (cs instanceof PDFName) return (nameOf(cs) ?? '?').replace(/^Device/, '');
  if (cs instanceof PDFArray && cs.size() > 0) {
    const fam = nameOf(cs.get(0));
    if (fam === 'ICCBased') {
      const icc = dictOf(deref(ctx, cs.get(1)));
      const n = icc ? numOf(icc.get(N('N'))) : null;
      return 'ICC ' + ({ 1: 'Gray', 3: 'RGB', 4: 'CMYK' }[n ?? 0] ?? `${n} ch`);
    }
    if (fam === 'Indexed') return 'Indexed';
    if (fam === 'Separation') return 'Spot';
    return fam ?? '?';
  }
  return '?';
}

export function fontInfo(ctx: PDFContext, fd: PDFDict): FontInfo {
  const subtype = nameOf(fd.get(N('Subtype'))) ?? '?';
  const base = nameOf(fd.get(N('BaseFont'))) ?? (subtype === 'Type3' ? '(Type 3 font)' : '(unnamed)');
  let desc: PDFDict | null = null;
  if (subtype === 'Type0') {
    const d = fd.lookup(N('DescendantFonts'));
    const d0 = d instanceof PDFArray && d.size() ? dictOf(deref(ctx, d.get(0))) : null;
    desc = d0 ? dictOf(d0.lookup(N('FontDescriptor'))) : null;
  } else desc = dictOf(fd.lookup(N('FontDescriptor')));
  const embedded =
    subtype === 'Type3' || !!(desc && (desc.has(N('FontFile')) || desc.has(N('FontFile2')) || desc.has(N('FontFile3'))));
  return { name: base.replace(/^[A-Z]{6}\+/, ''), subtype, embedded };
}

export interface ResourceAcc {
  seenRes: Set<PDFDict>;
  fonts: Map<string, FontInfo>;
  images: Map<string, ImageInfo>;
  forms: Map<string, PDFDict>;
}
export const newAcc = (): ResourceAcc => ({ seenRes: new Set(), fonts: new Map(), images: new Map(), forms: new Map() });

function filterLabel(f: PDFObject | undefined): string {
  if (f instanceof PDFName) return (nameOf(f) ?? '').replace(/Decode$/, '');
  if (f instanceof PDFArray) return f.asArray().map((x) => nameOf(x)).join('+').replace(/Decode/g, '');
  return 'none';
}

/**
 * Walk a resource dictionary recursively: fonts, image and form XObjects, tiling patterns,
 * soft-mask groups and Type 3 font resources. `onForm` sees every form/group dictionary once.
 */
export function walkResources(
  ctx: PDFContext,
  resObj: PDFObject | undefined,
  acc: ResourceAcc,
  onForm?: (d: PDFDict) => void,
  depth = 0,
): void {
  if (depth > 40) return;
  const res = dictOf(deref(ctx, resObj));
  if (!res || acc.seenRes.has(res)) return;
  acc.seenRes.add(res);

  const visitForm = (ref: PDFObject, key: string) => {
    const d = dictOf(deref(ctx, ref));
    if (!d) return;
    const id = ref instanceof PDFRef ? ref.toString() : key;
    if (acc.forms.has(id)) return;
    acc.forms.set(id, d);
    onForm?.(d);
    walkResources(ctx, d.get(N('Resources')), acc, onForm, depth + 1);
  };

  const fonts = dictOf(deref(ctx, res.get(N('Font'))));
  if (fonts)
    for (const [k, v] of fonts.entries()) {
      const fd = dictOf(deref(ctx, v));
      if (!fd) continue;
      const id = v instanceof PDFRef ? v.toString() : `f${acc.fonts.size}${nameOf(k)}`;
      if (acc.fonts.has(id)) continue;
      const info = fontInfo(ctx, fd);
      acc.fonts.set(id, info);
      if (info.subtype === 'Type3') walkResources(ctx, fd.get(N('Resources')), acc, onForm, depth + 1);
    }

  const xobjs = dictOf(deref(ctx, res.get(N('XObject'))));
  if (xobjs)
    for (const [k, v] of xobjs.entries()) {
      const d = dictOf(deref(ctx, v));
      if (!d) continue;
      const sub = nameOf(d.get(N('Subtype')));
      const id = v instanceof PDFRef ? v.toString() : `x${nameOf(k)}${depth}`;
      if (sub === 'Image') {
        const prev = acc.images.get(id);
        if (prev) {
          prev.uses++;
          continue;
        }
        const w = numOf(d.lookup(N('Width'))) ?? 0;
        const h = numOf(d.lookup(N('Height'))) ?? 0;
        acc.images.set(id, {
          name: nameOf(k) ?? '?',
          w,
          h,
          mp: (w * h) / 1e6,
          bpc: numOf(d.lookup(N('BitsPerComponent'))),
          cs: isTrue(d.lookup(N('ImageMask'))) ? 'Mask' : colorSpaceLabel(ctx, d.get(N('ColorSpace'))),
          alpha: d.has(N('SMask')),
          filter: filterLabel(d.lookup(N('Filter'))),
          uses: 1,
        });
      } else if (sub === 'Form') visitForm(v, `form${nameOf(k)}${depth}`);
    }

  const patterns = dictOf(deref(ctx, res.get(N('Pattern'))));
  if (patterns)
    for (const [k, v] of patterns.entries()) {
      const d = dictOf(deref(ctx, v));
      if (d && numOf(d.get(N('PatternType'))) === 1) visitForm(v, `pat${nameOf(k)}${depth}`);
    }

  const gstates = dictOf(deref(ctx, res.get(N('ExtGState'))));
  if (gstates)
    for (const [, v] of gstates.entries()) {
      const gs = dictOf(deref(ctx, v));
      const sm = gs ? dictOf(deref(ctx, gs.get(N('SMask')))) : null;
      const g = sm?.get(N('G'));
      if (g) visitForm(g, `smask${depth}`);
    }
}

export function pageBox(page: PDFPage): Box {
  const b = page.getCropBox();
  return [b.x, b.y, b.x + b.width, b.y + b.height];
}

export function userUnitOf(page: PDFPage): number {
  return numOf(page.node.get(N('UserUnit'))) ?? 1;
}

export function analysePage(doc: PDFDocument, page: PDFPage, index: number): PageReport {
  const acc = newAcc();
  walkResources(doc.context, inherited(page.node, 'Resources'), acc);
  const box = page.getCropBox();
  const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
  let wPt = box.width;
  let hPt = box.height;
  if (rot === 90 || rot === 270) [wPt, hPt] = [hPt, wPt];
  const images = [...acc.images.values()];
  const fonts = [...acc.fonts.values()];
  const totalMP = images.reduce((s, i) => s + i.mp, 0);
  const huge = totalMP > HUGE_MP;
  const r: PageReport = { index, wPt, hPt, userUnit: userUnitOf(page), rotation: rot, images, fonts, totalMP, huge, status: 'vector', artwork: null };
  r.status = pageStatus(r);
  return r;
}

/** The main status of a page. The first match wins: huge, fonts, pixel, traced, raster, vector. */
export function pageStatus(r: Pick<PageReport, 'huge' | 'fonts' | 'images'> & { artwork: ArtworkCheck | null }): PageStatus {
  if (r.huge) return 'huge';
  if (r.fonts.length) return 'fonts';
  if (r.artwork?.pixel) return 'pixel';
  if (r.artwork?.traced) return 'traced';
  return r.images.length ? 'raster' : 'vector';
}

/** Find the %PDF header within the first 1024 bytes. */
export function findHeader(bytes: Uint8Array): { offset: number; version: string } | null {
  const lim = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i <= lim; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46) {
      let v = '';
      for (let j = i + 5; j < i + 12 && j < bytes.length; j++) {
        const c = bytes[j]!;
        if ((c >= 0x30 && c <= 0x39) || c === 0x2e) v += String.fromCharCode(c);
        else break;
      }
      return { offset: i, version: v };
    }
  }
  return null;
}
