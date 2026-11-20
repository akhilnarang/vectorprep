/**
 * Re-emit selected elements as a standalone content stream.
 *
 * For an element we walk its ancestor chain from the page root and replay every state
 * operation that precedes it in each container (cm, gs, colours, clips, text state), open a
 * q for each block and a q + Matrix + BBox clip for each form, emit the element itself, then
 * close. Resource names are rewritten to fresh names so resources from different
 * dictionaries (page vs. forms) never clash; only resources that are actually used are listed.
 */
import { PDFContext, PDFObject } from '@cantoo/pdf-lib';
import { lookupRes } from '../objects';
import type { ElementNode, StreamCtx } from './elements';
import { MARKED } from './elements';
import type { Op } from './tokenizer';

const DEVICE_CS = new Set(['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'Pattern']);
const RES_PREFIX: Record<string, string> = { ExtGState: 'GS', XObject: 'X', Font: 'F', ColorSpace: 'CS', Pattern: 'P', Shading: 'Sh' };

export interface Renamer {
  out: Record<string, [string, PDFObject][]>;
  name(sctx: StreamCtx, cat: string, name: string): string;
}

export function makeRenamer(ctx: PDFContext): Renamer {
  const map = new Map<string, string>();
  const out: Record<string, [string, PDFObject][]> = {};
  let seq = 0;
  return {
    out,
    name(sctx, cat, name) {
      const key = `${sctx.rid}|${cat}|${name}`;
      const known = map.get(key);
      if (known) return known;
      const v = lookupRes(ctx, sctx.res, cat, name);
      if (v === undefined) {
        map.set(key, name);
        return name;
      }
      const nn = `${RES_PREFIX[cat] ?? 'R'}${++seq}`;
      map.set(key, nn);
      (out[cat] ??= []).push([nn, v]);
      return nn;
    },
  };
}

export const fmtN = (x: number): string => (Math.round(x * 1e6) / 1e6).toString();

export function emitOp(sctx: StreamCtx, o: Op, R: Renamer): string | null {
  if (MARKED.has(o.op)) return null; // marked content (layers, tags) is dropped
  if (o.op === 'BI') return o.raw ?? null;
  const args = o.args.map((x) => x.raw);
  const ren = (idx: number, cat: string) => {
    const t = o.args[idx];
    if (t && t.t === 'name' && typeof t.v === 'string') args[idx] = '/' + R.name(sctx, cat, t.v);
  };
  const first = o.args[0];
  switch (o.op) {
    case 'gs':
      ren(0, 'ExtGState');
      break;
    case 'Do':
      ren(0, 'XObject');
      break;
    case 'Tf':
      ren(0, 'Font');
      break;
    case 'sh':
      ren(0, 'Shading');
      break;
    case 'cs':
    case 'CS':
      if (first && typeof first.v === 'string' && !DEVICE_CS.has(first.v)) ren(0, 'ColorSpace');
      break;
    case 'scn':
    case 'SCN':
      if (o.args.length && o.args[o.args.length - 1]!.t === 'name') ren(o.args.length - 1, 'Pattern');
      break;
    default:
  }
  return args.length ? `${args.join(' ')} ${o.op}` : o.op;
}

function pushOps(out: string[], sctx: StreamCtx, from: number, to: number, R: Renamer): void {
  for (let i = from; i < to; i++) {
    const s = emitOp(sctx, sctx.ops[i]!, R);
    if (s) out.push(s);
  }
}

/** Append the content needed to draw `node` exactly as on the page. */
export function emitNode(node: ElementNode, R: Renamer, out: string[]): void {
  const chain: ElementNode[] = [];
  for (let n: ElementNode | null = node; n; n = n.parent) chain.unshift(n);
  let opened = 0;
  for (let k = 0; k < chain.length - 1; k++) {
    const C = chain[k]!;
    const next = chain[k + 1]!;
    let sctx = C.sctx;
    if (C.k === 'block') {
      out.push('q');
      opened++;
    }
    if (C.k === 'form') {
      const b = C.fbbox!;
      out.push('q', `${C.matrix!.map(fmtN).join(' ')} cm`, `${fmtN(b[0])} ${fmtN(b[1])} ${fmtN(b[2] - b[0])} ${fmtN(b[3] - b[1])} re W n`);
      opened++;
      sctx = C.fsctx!;
    }
    for (const item of C.items ?? []) {
      if (item.t === 'e' && item.node === next) break;
      if (item.t === 's') {
        for (const i of item.ops) {
          const s = emitOp(sctx, sctx.ops[i]!, R);
          if (s) out.push(s);
        }
        continue;
      }
      // Skipped sibling elements may still change state that later siblings rely on.
      const n = item.node;
      if (n.k === 'text') {
        for (const i of n.stateOps ?? []) {
          const s = emitOp(sctx, sctx.ops[i]!, R);
          if (s) out.push(s);
        }
      } else if (n.k === 'path' && n.clipSide) {
        pushOps(out, sctx, n.start, n.end - 1, R);
        out.push('n');
      }
    }
  }
  pushOps(out, node.sctx, node.start, node.end, R);
  if (node.k === 'block' && node.unclosed) out.push('Q');
  for (let k = 0; k < opened; k++) out.push('Q');
}
