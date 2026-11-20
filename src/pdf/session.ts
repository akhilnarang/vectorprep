/** One open document and its cached element trees. This is what the worker exposes. */
import { PDFDocument, ParseSpeeds } from '@cantoo/pdf-lib';
import type { ElementPdfOptions, ElementPdfResult, ElementTreeDTO, ImageResult, OpenResult } from '../shared/types';
import { ElementNode, ElementTree, buildTree, toDTO } from './content/elements';
import { cleanSource, exportElements, exportPages } from './export';
import { decodeImage } from './image';
import { FormCache, checkArtwork } from './artwork';
import { analysePage, findHeader, pageStatus } from './inspect';
import { N } from './objects';

export class PdfSession {
  private doc: PDFDocument | null = null;
  private cleaned = false;
  private trees = new Map<number, ElementTree>();

  async open(input: Blob | Uint8Array, name: string, progress?: (msg: string) => void): Promise<OpenResult> {
    this.doc = null;
    this.cleaned = false;
    this.trees.clear();
    const t0 = performance.now();
    progress?.('Reading file…');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
    const tRead = performance.now() - t0;
    const header = findHeader(bytes);
    if (!header) {
      let head = '';
      for (let i = 0; i < Math.min(32, bytes.length); i++) head += String.fromCharCode(bytes[i]!);
      const isAi = /\.ai$/i.test(name) || head.startsWith('%!PS-Adobe');
      return { error: isAi ? 'no-pdf-compat' : 'not-pdf' };
    }
    progress?.('Reading the PDF structure…');
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
      parseSpeed: ParseSpeeds.Fastest,
    });
    if (doc.isEncrypted) return { error: 'encrypted' };
    const tParse = performance.now() - t0 - tRead;
    progress?.('Checking the artboards…');
    const docPages = doc.getPages();
    const pages = docPages.map((p, i) => analysePage(doc, p, i));
    progress?.('Checking the artwork…');
    const tArt = performance.now();
    const forms: FormCache = new Map();
    for (const r of pages) {
      try {
        r.artwork = checkArtwork(doc, docPages[r.index]!, r.userUnit, forms);
      } catch (err) {
        console.warn(`Artwork check failed on page ${r.index + 1}`, err);
      }
      r.status = pageStatus(r);
    }
    const artMs = performance.now() - tArt;
    this.doc = doc;
    const safe = <T>(f: () => T): T | null => {
      try {
        return f() ?? null;
      } catch {
        return null;
      }
    };
    const creator = safe(() => doc.getCreator() ?? null);
    return {
      header,
      pages,
      creator,
      producer: safe(() => doc.getProducer() ?? null),
      isIllustrator: /illustrator/i.test(creator ?? '') || !!doc.catalog.get(N('PieceInfo')),
      timings: {
        read: Math.round(tRead),
        parse: Math.round(tParse),
        analyse: Math.round(performance.now() - t0 - tRead - tParse),
        artwork: Math.round(artMs),
      },
    };
  }

  private requireDoc(): PDFDocument {
    if (!this.doc) throw new Error('No document is open');
    return this.doc;
  }

  private cleanedDoc(): PDFDocument {
    const doc = this.requireDoc();
    if (!this.cleaned) {
      cleanSource(doc);
      this.cleaned = true;
    }
    return doc;
  }

  tree(pageIndex: number): ElementTree {
    let t = this.trees.get(pageIndex);
    if (!t) {
      t = buildTree(this.requireDoc(), pageIndex);
      this.trees.set(pageIndex, t);
    }
    return t;
  }

  exportPdf(indices: number[], title?: string): Promise<Uint8Array> {
    return exportPages(this.cleanedDoc(), indices, title);
  }

  elements(pageIndex: number): ElementTreeDTO {
    const t0 = performance.now();
    const t = this.tree(pageIndex);
    return toDTO(t, Math.round(performance.now() - t0));
  }

  elementPdf(pageIndex: number, ids: number[], opts?: ElementPdfOptions): Promise<ElementPdfResult> {
    const doc = this.cleanedDoc();
    return exportElements(doc, this.tree(pageIndex), ids, opts);
  }

  imageOriginal(pageIndex: number, id: number): Promise<ImageResult> {
    const tree = this.tree(pageIndex);
    let node: ElementNode | undefined = tree.nodes[id];
    if (node && node.k !== 'image') {
      const imgs: ElementNode[] = [];
      const walk = (n: ElementNode) => {
        if (n.k === 'image' && !n.inv) imgs.push(n);
        (n.children ?? []).forEach(walk);
      };
      walk(node);
      node = imgs.length === 1 ? imgs[0] : undefined;
    }
    if (!node || node.k !== 'image' || !node.xobj) throw new Error('The selection is not one raster image.');
    return decodeImage(this.requireDoc().context, node.xobj, node.name ?? 'image');
  }
}
