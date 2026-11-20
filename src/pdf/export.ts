/** Cleaning and export: whole artboards, and selected elements as a new one-page PDF. */
import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectCopier,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFString,
  degrees,
} from '@cantoo/pdf-lib';
import type { Box, ElementPdfOptions, ElementPdfResult } from '../shared/types';
import type { ElementTree } from './content/elements';
import { emitNode, fmtN, makeRenamer } from './content/emit';
import { union } from './content/geometry';
import { ELEMENT_MARGIN_MM } from '../shared/constants';
import { latin1ToBytes } from './content/tokenizer';
import { deflate } from './flate';
import { newAcc, userUnitOf, walkResources } from './inspect';
import { N, deref, dictOf, inherited, nameOf } from './objects';

export const PRODUCER = 'VectorPrep (@cantoo/pdf-lib)';
const PRIVATE_PAGE_KEYS = ['PieceInfo', 'LastModified', 'Thumb', 'Metadata'];

/**
 * Remove editor-private data from the in-memory source so that it is never copied:
 * page /PieceInfo, /LastModified, /Thumb, /Metadata; form /PieceInfo; annotation back-links
 * (/P) and internal links, which would otherwise drag other pages into an export.
 */
export function cleanSource(doc: PDFDocument): void {
  const ctx = doc.context;
  const pageRefs = new Set(doc.getPages().map((p) => p.ref.toString()));
  for (const page of doc.getPages()) {
    const node = page.node;
    for (const k of PRIVATE_PAGE_KEYS) node.delete(N(k));
    walkResources(ctx, inherited(node, 'Resources'), newAcc(), (d) => {
      d.delete(N('PieceInfo'));
      d.delete(N('LastModified'));
    });
    const annots = node.lookup(N('Annots'));
    if (annots instanceof PDFArray) {
      const keep = [];
      for (let i = 0; i < annots.size(); i++) {
        const raw = annots.get(i);
        const a = dictOf(deref(ctx, raw));
        if (!a) continue;
        a.delete(N('P'));
        dictOf(a.lookup(N('Popup')))?.delete(N('P'));
        if (pointsToPage(ctx, a, pageRefs)) continue;
        keep.push(raw);
      }
      if (keep.length) node.set(N('Annots'), ctx.obj(keep));
      else node.delete(N('Annots'));
    }
  }
}

function pointsToPage(ctx: PDFContext, annot: PDFDict, pageRefs: Set<string>): boolean {
  const isPageDest = (destIn: ReturnType<PDFDict['get']>): boolean => {
    let dest = deref(ctx, destIn);
    if (dest instanceof PDFDict) dest = deref(ctx, dest.get(N('D')));
    if (dest instanceof PDFArray && dest.size()) {
      const first = dest.get(0);
      return first instanceof PDFRef && pageRefs.has(first.toString());
    }
    // named destinations would point nowhere once the pages are split
    return dest instanceof PDFName || dest instanceof PDFString || dest instanceof PDFHexString;
  };
  if (annot.has(N('Dest')) && isPageDest(annot.get(N('Dest')))) return true;
  const action = dictOf(annot.lookup(N('A')));
  return !!action && nameOf(action.get(N('S'))) === 'GoTo' && isPageDest(action.get(N('D')));
}

/** Illustrator often stores Form XObjects uncompressed; Flate-compress any stream without a filter. */
export async function compressPlainStreams(out: PDFDocument): Promise<void> {
  for (const [ref, obj] of out.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.has(N('Filter')) || obj.contents.length < 512) continue;
    const d = await deflate(obj.contents);
    if (d.length >= obj.contents.length) continue;
    obj.dict.set(N('Filter'), N('FlateDecode'));
    obj.dict.delete(N('DecodeParms'));
    out.context.assign(ref, PDFRawStream.of(obj.dict, d));
  }
}

async function finish(src: PDFDocument, out: PDFDocument, title?: string): Promise<Uint8Array> {
  await compressPlainStreams(out);
  let creator: string | undefined;
  try {
    creator = src.getCreator();
  } catch {
    creator = undefined;
  }
  if (creator) out.setCreator(creator);
  out.setProducer(PRODUCER);
  if (title) out.setTitle(title);
  // Classic xref table (no object streams) for maximum compatibility with older importers.
  return out.save({ useObjectStreams: false });
}

/** Copy the given pages (0-based) into a new document. Unreferenced objects are dropped. */
export async function exportPages(src: PDFDocument, indices: number[], title?: string): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const copier = PDFObjectCopier.for(src.context, out.context);
  const pages = src.getPages();
  for (const i of indices) {
    const p = pages[i];
    if (!p) throw new Error(`No page ${i + 1}`);
    const copied = copier.copy(p.node);
    const ref = out.context.register(copied);
    out.addPage(PDFPage.of(copied, ref, out));
  }
  // Keep layer (optional content) definitions so layered content still shows correctly.
  const ocp = src.catalog.lookup(N('OCProperties'));
  if (ocp instanceof PDFDict) out.catalog.set(N('OCProperties'), copier.copy(ocp));
  return finish(src, out, title);
}

/** Build a one-page vector PDF that contains only the selected elements. */
export async function exportElements(
  src: PDFDocument,
  tree: ElementTree,
  ids: number[],
  opts: ElementPdfOptions = {},
): Promise<ElementPdfResult> {
  const ctx = src.context;
  const idSet = new Set(ids);
  // drop nodes whose ancestor is also selected; keep paint order (ids are assigned in content order)
  const sel = ids
    .map((id) => tree.nodes[id])
    .filter((n): n is NonNullable<typeof n> => !!n && n.k !== 'root')
    .filter((n) => {
      for (let p = n.parent; p; p = p.parent) if (idSet.has(p.id)) return false;
      return true;
    })
    .sort((a, b) => a.id - b.id);
  if (!sel.length) throw new Error('No elements are selected.');

  const warnings: string[] = [];
  let box: Box | null = null;
  for (const n of sel) box = union(box, n.inv ? null : n.bbox);
  if (!box) {
    box = [...tree.pbox];
    warnings.push('The selection has no visible size. The PDF uses the full artboard size.');
  }
  if (sel.some((n) => n.approx)) warnings.push('Some sizes are approximate. The page can have an extra margin.');
  const page = tree.page;
  const uu = userUnitOf(page);
  const marginPt = ((opts.marginMm ?? ELEMENT_MARGIN_MM) * 72) / 25.4 / uu;
  box = [box[0] - marginPt, box[1] - marginPt, box[2] + marginPt, box[3] + marginPt];

  const R = makeRenamer(ctx);
  const lines = [`1 0 0 1 ${fmtN(-box[0])} ${fmtN(-box[1])} cm`];
  for (const n of sel) {
    lines.push('q');
    emitNode(n, R, lines);
    lines.push('Q');
  }
  const content = await deflate(latin1ToBytes(lines.join('\n') + '\n'));

  const out = await PDFDocument.create();
  const copier = PDFObjectCopier.for(ctx, out.context);
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const p = out.addPage([w, h]);
  const resDict = out.context.obj({});
  for (const [cat, entries] of Object.entries(R.out)) {
    const d = out.context.obj({});
    for (const [nn, v] of entries) d.set(N(nn), copier.copy(v));
    resDict.set(N(cat), d);
  }
  p.node.set(N('Resources'), resDict);
  const contentDict = out.context.obj({ Filter: 'FlateDecode' });
  p.node.set(N('Contents'), out.context.register(PDFRawStream.of(contentDict, content)));
  if (uu !== 1) p.node.set(N('UserUnit'), PDFNumber.of(uu));
  const group = page.node.get(N('Group'));
  if (group) p.node.set(N('Group'), copier.copy(group));
  const rot = page.getRotation().angle || 0;
  if (rot) p.setRotation(degrees(rot));
  const bytes = await finish(src, out, opts.title);
  return { bytes, box, sizePt: [w, h], userUnit: uu, warnings, count: sel.length };
}
