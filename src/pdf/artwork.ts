/**
 * Artwork checks for the artboard report: "fake vector" files and very large object counts.
 *
 * The checks use the counting pass in `content/scan.ts`. They read the page content and
 * every form XObject that it draws. They do not build the element tree. Refer to
 * docs/architecture.md, "Artwork checks", for the thresholds and the reasons for them.
 */
import { PDFArray, PDFContext, PDFDict, PDFDocument, PDFPage, PDFRawStream } from '@cantoo/pdf-lib';
import {
  MANY_OBJECTS,
  PIXEL_MIN_RECTS,
  PIXEL_MIN_SOURCE_PX,
  PIXEL_MIN_UNIT_SHARE,
  PIXEL_ON_GRID,
  PIXEL_RECT_SHARE,
  SCAN_MAX_BYTES,
  TRACED_MAX_STROKE_SHARE,
  TRACED_MIN_COLOURS,
  TRACED_MIN_CURVED_SHARE,
  TRACED_MIN_FILLS,
} from '../shared/constants';
import type { ArtworkCheck, PixelArt } from '../shared/types';
import { decodeStreamSync } from './content/elements';
import { IDENTITY, Matrix, mul } from './content/geometry';
import { ScanGState, ScanStats, newScanStats, scanContent } from './content/scan';
import { N, deref, dictOf, inherited, lookupRes, nameOf, numsOf } from './objects';

const MAX_FORM_DEPTH = 8;

/** Decoded form streams, shared by all pages of one document. */
export type FormCache = Map<PDFRawStream, Uint8Array | null>;

function decoded(cache: FormCache, st: PDFRawStream): Uint8Array | null {
  let d = cache.get(st);
  if (d === undefined) {
    try {
      d = decodeStreamSync(st);
    } catch {
      d = null;
    }
    cache.set(st, d);
  }
  return d;
}

/** Count the drawing operations of one page, including the form XObjects that it draws. */
export function scanPage(ctx: PDFContext, page: PDFPage, cache: FormCache = new Map()): ScanStats {
  const st = newScanStats();
  const active = new Set<PDFRawStream>();

  const run = (data: Uint8Array, res: PDFDict | null, gs: ScanGState, depth: number) => {
    scanContent(data, st, gs, (name, g) => {
      if (st.partial) return;
      const xo = deref(ctx, lookupRes(ctx, res, 'XObject', name));
      const d = dictOf(xo);
      if (!d || !(xo instanceof PDFRawStream)) return;
      const sub = nameOf(d.get(N('Subtype')));
      if (sub === 'Image') {
        st.images++;
        return;
      }
      if (sub !== 'Form' || depth >= MAX_FORM_DEPTH || active.has(xo)) return;
      st.forms++;
      const bytes = decoded(cache, xo);
      if (!bytes) return;
      const fm = (numsOf(ctx, d.get(N('Matrix'))) ?? IDENTITY) as Matrix;
      const fres = dictOf(deref(ctx, d.get(N('Resources')))) ?? res;
      active.add(xo);
      run(bytes, fres, { ctm: mul(fm, g.ctm), fill: g.fill }, depth + 1);
      active.delete(xo);
    }, SCAN_MAX_BYTES);
  };

  const res = dictOf(deref(ctx, inherited(page.node, 'Resources')));
  const contents = deref(ctx, page.node.get(N('Contents')));
  const parts = contents instanceof PDFArray ? contents.asArray() : [contents];
  // Each part of a Contents array continues the same stream. Scan the joined bytes.
  const chunks: Uint8Array[] = [];
  for (const p of parts) {
    const s = deref(ctx, p);
    if (s instanceof PDFRawStream) {
      try {
        chunks.push(decodeStreamSync(s));
      } catch {
        st.partial = true;
      }
    }
  }
  const all = chunks.length === 1 ? chunks[0]! : joinChunks(chunks);
  run(all, res, { ctm: IDENTITY, fill: 'g 0' }, 0);
  return st;
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length + 1, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
    out[o++] = 10;
  }
  return out;
}

/**
 * Find the common size unit of the filled rectangles, in 1/100 pt.
 * The unit is the smallest frequent size of which most widths and most heights are whole multiples.
 */
export function gridUnit(wHist: Map<number, number>, hHist: Map<number, number>): number | null {
  let total = 0;
  const both = new Map<number, number>();
  for (const h of [wHist, hHist])
    for (const [k, v] of h) {
      both.set(k, (both.get(k) ?? 0) + v);
      total += v;
    }
  if (!total) return null;
  const candidates = [...both.entries()]
    .filter(([, v]) => v / total >= PIXEL_MIN_UNIT_SHARE)
    .map(([k]) => k)
    .sort((a, b) => a - b);
  const onGrid = (hist: Map<number, number>, u: number) => {
    let ok = 0;
    let n = 0;
    for (const [k, v] of hist) {
      n += v;
      const r = k / u;
      if (r >= 0.97 && Math.abs(r - Math.round(r)) <= 0.03) ok += v;
    }
    return n ? ok / n : 0;
  };
  for (const u of candidates) if (onGrid(wHist, u) >= PIXEL_ON_GRID && onGrid(hHist, u) >= PIXEL_ON_GRID) return u;
  return null;
}

/** Turn the counts of one page into the report flags. `userUnit` gives the real size of one unit. */
export function classifyArtwork(st: ScanStats, userUnit: number, ms = 0): ArtworkCheck {
  let pixel: PixelArt | null = null;
  if (st.rects >= PIXEL_MIN_RECTS && st.rects >= PIXEL_RECT_SHARE * st.fillSubpaths && st.rectBox) {
    const u = gridUnit(st.wHist, st.hHist);
    if (u) {
      const unitPt = u / 100;
      const b = st.rectBox;
      const srcW = Math.round((b[2] - b[0]) / unitPt);
      const srcH = Math.round((b[3] - b[1]) / unitPt);
      if (Math.max(srcW, srcH) >= PIXEL_MIN_SOURCE_PX)
        pixel = { rects: st.rects, unitPt, srcW, srcH, dpi: 72 / (unitPt * (userUnit || 1)) };
    }
  }
  const traced =
    !pixel &&
    st.fills >= TRACED_MIN_FILLS &&
    st.colours.size >= TRACED_MIN_COLOURS &&
    st.curvedFills >= TRACED_MIN_CURVED_SHARE * st.fills &&
    st.strokes <= TRACED_MAX_STROKE_SHARE * st.fills &&
    st.text === 0 &&
    st.shadings === 0 &&
    st.patterns === 0;
  return {
    drawOps: st.drawOps,
    fills: st.fills,
    strokes: st.strokes,
    curvedFills: st.curvedFills,
    colours: st.colours.size,
    rects: st.rects,
    text: st.text,
    shadings: st.shadings,
    patterns: st.patterns,
    forms: st.forms,
    bytes: st.bytes,
    partial: st.partial,
    ms,
    pixel,
    traced,
    many: st.drawOps > MANY_OBJECTS || st.fills > MANY_OBJECTS,
  };
}

/** Run the artwork checks on one page. */
export function checkArtwork(doc: PDFDocument, page: PDFPage, userUnit: number, cache?: FormCache): ArtworkCheck {
  const t0 = performance.now();
  const st = scanPage(doc.context, page, cache);
  return classifyArtwork(st, userUnit, Math.round((performance.now() - t0) * 10) / 10);
}
