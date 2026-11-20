/**
 * Content-stream element model.
 *
 * A stream is interpreted once. Every q…Q block, painted path, image/form Do, text object,
 * shading and inline image becomes an element node with a conservative bounding box in page
 * space. Containers (root, blocks, expanded forms) keep an ordered item list of state
 * operations and child elements, which is what extraction replays (see emit.ts).
 */
import { PDFArray, PDFContext, PDFDict, PDFDocument, PDFPage, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import type { Box, ElementDTO, ElementKind, ElementTreeDTO } from '../../shared/types';
import { pageBox, userUnitOf } from '../inspect';
import { N, deref, dictOf, inherited, lookupRes, nameOf, numOf, numsOf } from '../objects';
import { IDENTITY, Matrix, extend, intersect, mul, scaleOf, transformRect, union } from './geometry';
import { Op, bytesToLatin1, nameArg, numArg, tokenize } from './tokenizer';

export interface StreamCtx {
  ops: Op[];
  res: PDFDict | null;
  /** identity of `res`, used to key renamed resources */
  rid: number;
}

export type Item = { t: 's'; ops: number[] } | { t: 'e'; node: ElementNode };

export interface ElementNode {
  id: number;
  k: ElementKind;
  /** stream that contains this node's own operations */
  sctx: StreamCtx;
  /** [start, end) operation indices in sctx */
  start: number;
  end: number;
  parent: ElementNode | null;
  items: Item[] | null;
  children: ElementNode[] | null;
  bbox: Box | null;
  approx: boolean;
  inv: boolean;
  // kind-specific
  clipSide?: boolean; // path that also sets a clip (W f)
  paint?: string;
  name?: string; // XObject name
  xobj?: PDFRawStream; // image XObject
  w?: number;
  h?: number;
  matrix?: Matrix; // form
  fbbox?: Box; // form
  fsctx?: StreamCtx | null; // form content
  stateOps?: number[]; // text: state operators inside BT…ET
  unclosed?: boolean;
}

export interface ElementTree {
  nodes: ElementNode[];
  root: ElementNode;
  pbox: Box;
  page: PDFPage;
  opsTotal: number;
}

interface GState {
  ctm: Matrix;
  clip: Box | null | undefined;
  lw: number;
  ca: number;
  CA: number;
  fs: number;
  t0: boolean; // current font is Type0 (2-byte codes, approx)
  Th: number;
  TL: number;
  rise: number;
}

const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);
const STROKES = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);
const FILLS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const PATHC = new Set(['m', 'l', 'c', 'v', 'y', 're', 'h']);
export const MARKED = new Set(['BDC', 'BMC', 'EMC', 'MP', 'DP', 'BX', 'EX']);
const MAX_FORM_DEPTH = 4;
const MAX_OPS = 400_000;

let resIdSeq = 0;
const resIds = new WeakMap<PDFDict, number>();
export function resId(res: PDFDict | null): number {
  if (!res) return 0;
  let id = resIds.get(res);
  if (!id) {
    id = ++resIdSeq;
    resIds.set(res, id);
  }
  return id;
}

export function decodeStreamSync(st: PDFRawStream): Uint8Array {
  return decodePDFRawStream(st).decode();
}

function contentBytes(ctx: PDFContext, contents: ReturnType<PDFDict['get']>): Uint8Array {
  const c = deref(ctx, contents);
  const parts: Uint8Array[] = [];
  const add = (o: ReturnType<PDFDict['get']>) => {
    const st = deref(ctx, o);
    if (st instanceof PDFRawStream) parts.push(decodeStreamSync(st));
  };
  if (c instanceof PDFArray) for (let i = 0; i < c.size(); i++) add(c.get(i));
  else add(c);
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length + 1, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
    out[o++] = 10;
  }
  return out;
}

type Mk = (k: ElementKind, sctx: StreamCtx, props?: Partial<ElementNode>) => ElementNode;

/** Build the element tree for one page. */
export function buildTree(doc: PDFDocument, pageIndex: number): ElementTree {
  const ctx = doc.context;
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error(`No page ${pageIndex + 1}`);
  const res = dictOf(deref(ctx, inherited(page.node, 'Resources')));
  const pbox = pageBox(page);
  const ops = tokenize(bytesToLatin1(contentBytes(ctx, page.node.get(N('Contents')))));
  const sctx: StreamCtx = { ops, res, rid: resId(res) };
  const nodes: ElementNode[] = [];
  const mk: Mk = (k, s, props) => {
    const n: ElementNode = {
      id: nodes.length, k, sctx: s, start: 0, end: 0, parent: null, items: null, children: null,
      bbox: null, approx: false, inv: false, ...props,
    };
    nodes.push(n);
    return n;
  };
  const root = mk('root', sctx, { items: [], children: [], end: ops.length });
  const tree: ElementTree = { nodes, root, pbox, page, opsTotal: ops.length };
  const gs0: GState = { ctm: IDENTITY, clip: [...pbox], lw: 1, ca: 1, CA: 1, fs: 0, t0: false, Th: 1, TL: 0, rise: 0 };
  runStream(ctx, tree, sctx, root, gs0, 0, mk);
  finishContainer(root);
  root.bbox = root.bbox ?? [...pbox];
  return tree;
}

function finishContainer(c: ElementNode): void {
  let b: Box | null = null;
  let vis = false;
  for (const ch of c.children ?? []) {
    if (!ch.inv && ch.bbox) {
      b = union(b, ch.bbox);
      vis = true;
    }
  }
  if (c.k !== 'form' || (c.children && c.children.length)) {
    c.bbox = b;
    c.inv = !vis;
  }
  if ((c.children ?? []).some((ch) => ch.approx && !ch.inv)) c.approx = true;
}

function runStream(
  ctx: PDFContext,
  tree: ElementTree,
  sctx: StreamCtx,
  container: ElementNode,
  gsIn: GState,
  depth: number,
  mk: Mk,
): void {
  const ops = sctx.ops;
  const stack: ElementNode[] = [container];
  const gsStack: GState[] = [];
  let gs: GState = { ...gsIn };
  let path: { start: number; box: Box | null; clip: boolean } | null = null;
  let text: { node: ElementNode; Tm: Matrix; Tlm: Matrix; box: Box | null } | null = null;
  const cur = () => stack[stack.length - 1]!;

  const addState = (i: number) => {
    const items = cur().items!;
    const last = items[items.length - 1];
    if (last && last.t === 's') last.ops.push(i);
    else items.push({ t: 's', ops: [i] });
  };
  const addElem = (n: ElementNode) => {
    const c = cur();
    n.parent = c;
    c.items!.push({ t: 'e', node: n });
    c.children!.push(n);
  };
  const applyGs = (name: string) => {
    const d = dictOf(deref(ctx, lookupRes(ctx, sctx.res, 'ExtGState', name)));
    if (!d) return;
    const ca = numOf(d.lookup(N('ca')));
    const CA = numOf(d.lookup(N('CA')));
    const LW = numOf(d.lookup(N('LW')));
    if (ca !== null) gs.ca = ca;
    if (CA !== null) gs.CA = CA;
    if (LW !== null) gs.lw = LW;
    const font = d.lookup(N('Font'));
    if (font instanceof PDFArray) gs.fs = numOf(font.get(1)) ?? gs.fs;
  };
  const fontIsType0 = (name: string) => {
    const fd = dictOf(deref(ctx, lookupRes(ctx, sctx.res, 'Font', name)));
    return !!fd && nameOf(fd.get(N('Subtype'))) === 'Type0';
  };
  const setFont = (o: Op) => {
    gs.fs = numArg(o.args[1], gs.fs);
    gs.t0 = fontIsType0(nameArg(o.args[0]));
  };
  // Text bounds are an estimate: 0.6 em per glyph, from descender to ascender.
  const textShow = (glyphs: number) => {
    if (!text) return;
    const fs = gs.fs || 12;
    const w = glyphs * 0.6 * fs * gs.Th;
    const m = mul(text.Tm, gs.ctm);
    text.box = union(text.box, transformRect(m, 0, -0.3 * fs + gs.rise, w, fs * 1.05 + gs.rise));
    text.Tm = mul([1, 0, 0, 1, w, 0], text.Tm);
  };
  const strGlyphs = (raw: string) => {
    const n = raw[0] === '(' ? raw.length - 2 - (raw.match(/\\/g) ?? []).length : Math.ceil((raw.length - 2) / 2);
    return gs.t0 ? Math.ceil(n / 2) : n;
  };
  const nextLine = () => {
    if (!text) return;
    text.Tlm = mul([1, 0, 0, 1, 0, -gs.TL], text.Tlm);
    text.Tm = text.Tlm;
  };

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i]!;
    const op = o.op;
    const a = o.args;
    if (MARKED.has(op)) continue;

    if (text) {
      switch (op) {
        case 'ET': {
          const n = text.node;
          n.end = i + 1;
          n.bbox = intersect(text.box, gs.clip) ?? null;
          n.inv = !n.bbox || !(gs.ca > 0);
          n.approx = true;
          addElem(n);
          text = null;
          break;
        }
        case 'Td':
        case 'TD': {
          const tx = numArg(a[0]);
          const ty = numArg(a[1]);
          if (op === 'TD') gs.TL = -ty;
          text.Tlm = mul([1, 0, 0, 1, tx, ty], text.Tlm);
          text.Tm = text.Tlm;
          break;
        }
        case 'Tm':
          text.Tlm = text.Tm = [0, 1, 2, 3, 4, 5].map((k) => numArg(a[k])) as Matrix;
          break;
        case 'T*':
          nextLine();
          break;
        case 'Tj':
          textShow(a[0] ? strGlyphs(a[0].raw) : 0);
          break;
        case "'":
        case '"':
          nextLine();
          textShow(a.length ? strGlyphs(a[a.length - 1]!.raw) : 0);
          break;
        case 'TJ': {
          let g = 0;
          for (const m of (a[0]?.raw ?? '').matchAll(/\((?:\\.|[^\\)])*\)|<[^>]*>/g)) g += strGlyphs(m[0]);
          textShow(g);
          break;
        }
        default:
          text.node.stateOps!.push(i);
          if (op === 'Tf') setFont(o);
          else if (op === 'Tz') gs.Th = numArg(a[0], 100) / 100;
          else if (op === 'TL') gs.TL = numArg(a[0]);
          else if (op === 'Ts') gs.rise = numArg(a[0]);
          else if (op === 'gs') applyGs(nameArg(a[0]));
      }
      continue;
    }

    if (PATHC.has(op)) {
      if (!path) path = { start: i, box: null, clip: false };
      if (op === 're' && a.length >= 4) {
        const x = numArg(a[0]);
        const y = numArg(a[1]);
        path.box = union(path.box, transformRect(gs.ctm, x, y, x + numArg(a[2]), y + numArg(a[3])));
      } else if (op !== 'h') {
        for (let k = 0; k + 1 < a.length; k += 2) {
          const [px, py] = [numArg(a[k]), numArg(a[k + 1])];
          path.box = extend(path.box, [gs.ctm[0] * px + gs.ctm[2] * py + gs.ctm[4], gs.ctm[1] * px + gs.ctm[3] * py + gs.ctm[5]]);
        }
      }
      continue;
    }
    if (op === 'W' || op === 'W*') {
      if (path) path.clip = true;
      else addState(i);
      continue;
    }
    if (PAINT.has(op)) {
      if (!path) {
        addState(i);
        continue;
      }
      if (op === 'n') {
        if (path.clip) gs.clip = intersect(gs.clip, path.box);
        for (let k = path.start; k <= i; k++) addState(k);
      } else {
        let b = path.box;
        if (b && STROKES.has(op)) {
          const pad = (Math.max(gs.lw, 0.5) * scaleOf(gs.ctm)) / 2;
          b = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
        }
        const n = mk('path', sctx, { start: path.start, end: i + 1, clipSide: path.clip, paint: op });
        n.bbox = b ? intersect(b, gs.clip) ?? null : null;
        const vis = (FILLS.has(op) && gs.ca > 0) || (STROKES.has(op) && gs.CA > 0);
        n.inv = !n.bbox || !vis;
        addElem(n);
        // a clip set together with painting takes effect after the paint
        if (path.clip) gs.clip = intersect(gs.clip, path.box);
      }
      path = null;
      continue;
    }
    if (path) {
      // path construction not followed by a painting operator: keep it as state
      for (let k = path.start; k < i; k++) addState(k);
      path = null;
    }

    switch (op) {
      case 'q': {
        gsStack.push(gs);
        gs = { ...gs };
        const b = mk('block', sctx, { start: i, end: i + 1, items: [], children: [] });
        addElem(b);
        stack.push(b);
        break;
      }
      case 'Q':
        if (stack.length > 1) {
          const b = stack.pop()!;
          b.end = i + 1;
          finishContainer(b);
          gs = gsStack.pop() ?? gs;
        }
        break;
      case 'cm':
        if (a.length >= 6) gs.ctm = mul([0, 1, 2, 3, 4, 5].map((k) => numArg(a[k])) as Matrix, gs.ctm);
        addState(i);
        break;
      case 'w':
        gs.lw = numArg(a[0], 1);
        addState(i);
        break;
      case 'gs':
        applyGs(nameArg(a[0]));
        addState(i);
        break;
      case 'Tf':
        setFont(o);
        addState(i);
        break;
      case 'Tz':
        gs.Th = numArg(a[0], 100) / 100;
        addState(i);
        break;
      case 'TL':
        gs.TL = numArg(a[0]);
        addState(i);
        break;
      case 'Ts':
        gs.rise = numArg(a[0]);
        addState(i);
        break;
      case 'BT':
        text = { node: mk('text', sctx, { start: i, stateOps: [] }), Tm: IDENTITY, Tlm: IDENTITY, box: null };
        break;
      case 'BI': {
        const n = mk('inline', sctx, { start: i, end: i + 1, w: o.w ?? 0, h: o.h ?? 0 });
        n.bbox = intersect(transformRect(gs.ctm, 0, 0, 1, 1), gs.clip) ?? null;
        n.inv = !n.bbox;
        addElem(n);
        break;
      }
      case 'sh': {
        const n = mk('shading', sctx, { start: i, end: i + 1, approx: true });
        n.bbox = gs.clip === undefined ? [...tree.pbox] : gs.clip;
        n.inv = !n.bbox || !(gs.ca > 0);
        addElem(n);
        break;
      }
      case 'Do':
        doXObject(i, nameArg(a[0]));
        break;
      default:
        addState(i);
    }
  }
  if (path) for (let k = path.start; k < ops.length; k++) addState(k);
  while (stack.length > 1) {
    const b = stack.pop()!;
    b.end = ops.length;
    b.unclosed = true;
    finishContainer(b);
  }

  function doXObject(i: number, name: string): void {
    const xo = deref(ctx, lookupRes(ctx, sctx.res, 'XObject', name));
    const d = dictOf(xo);
    const sub = d ? nameOf(d.get(N('Subtype'))) : null;
    if (!d || !(xo instanceof PDFRawStream)) {
      addState(i);
      return;
    }
    if (sub === 'Image') {
      const n = mk('image', sctx, {
        start: i, end: i + 1, name, xobj: xo,
        w: numOf(d.lookup(N('Width'))) ?? 0, h: numOf(d.lookup(N('Height'))) ?? 0,
      });
      n.bbox = intersect(transformRect(gs.ctm, 0, 0, 1, 1), gs.clip) ?? null;
      n.inv = !n.bbox || !(gs.ca > 0);
      addElem(n);
      return;
    }
    if (sub !== 'Form') {
      addState(i);
      return;
    }
    const fm = (numsOf(ctx, d.get(N('Matrix'))) ?? IDENTITY) as Matrix;
    const fb = numsOf(ctx, d.get(N('BBox'))) ?? [0, 0, 0, 0];
    const fbn: Box = [Math.min(fb[0]!, fb[2]!), Math.min(fb[1]!, fb[3]!), Math.max(fb[0]!, fb[2]!), Math.max(fb[1]!, fb[3]!)];
    const ctm = mul(fm, gs.ctm);
    const clip = intersect(gs.clip, transformRect(ctm, fbn[0], fbn[1], fbn[2], fbn[3]));
    const n = mk('form', sctx, { start: i, end: i + 1, name, matrix: fm, fbbox: fbn, items: [], children: [] });
    n.bbox = clip ?? null;
    addElem(n);
    if (depth < MAX_FORM_DEPTH && tree.opsTotal < MAX_OPS) {
      try {
        const fres = dictOf(deref(ctx, d.get(N('Resources')))) ?? sctx.res;
        const fops = tokenize(bytesToLatin1(decodeStreamSync(xo)));
        tree.opsTotal += fops.length;
        n.fsctx = { ops: fops, res: fres, rid: resId(fres) };
        runStream(ctx, tree, n.fsctx, n, { ...gs, ctm, clip }, depth + 1, mk);
        finishContainer(n);
        if (n.bbox) n.bbox = intersect(n.bbox, clip) ?? null;
      } catch {
        n.fsctx = null;
        n.children = [];
        n.items = [];
        n.approx = true;
      }
    } else n.approx = true;
    if (!n.children!.length) {
      n.bbox = clip ?? null;
      n.inv = !clip;
    }
  }
}

export function label(n: ElementNode): string {
  switch (n.k) {
    case 'block':
      return 'Group';
    case 'path':
      return n.paint === 'S' || n.paint === 's' ? 'Stroked path' : 'Path';
    case 'image':
      return `Image ${n.name} (${n.w}×${n.h} px)`;
    case 'form':
      return `Form ${n.name}`;
    case 'text':
      return 'Text';
    case 'shading':
      return 'Gradient (shading)';
    case 'inline':
      return `Inline image (${n.w}×${n.h} px)`;
    default:
      return n.k;
  }
}

export function toDTO(tree: ElementTree, ms: number): ElementTreeDTO {
  const nodes: ElementDTO[] = tree.nodes.map((n) => ({
    id: n.id,
    p: n.parent ? n.parent.id : -1,
    k: n.k,
    b: n.bbox,
    a: n.approx,
    inv: n.inv,
    ch: n.children ? n.children.map((c) => c.id) : null,
    n: label(n),
  }));
  return { nodes, pbox: tree.pbox, userUnit: userUnitOf(tree.page), ms, ops: tree.opsTotal };
}
