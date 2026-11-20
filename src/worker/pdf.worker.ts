/** Module worker: all pdf-lib work runs here. The main thread talks to it through Comlink. */
import * as Comlink from 'comlink';
import { PdfSession } from '../pdf/session';
import type { ElementPdfOptions, PdfWorkerApi } from '../shared/types';

const session = new PdfSession();

const api: PdfWorkerApi = {
  open: (file, name, progress) => session.open(file, name, progress),
  async exportPdf(indices: number[], title?: string) {
    const bytes = await session.exportPdf(indices, title);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
  async elements(pageIndex: number) {
    return session.elements(pageIndex);
  },
  async elementPdf(pageIndex: number, ids: number[], opts?: ElementPdfOptions) {
    const r = await session.elementPdf(pageIndex, ids, opts);
    return Comlink.transfer(r, [r.bytes.buffer]);
  },
  async imageOriginal(pageIndex: number, id: number) {
    const r = await session.imageOriginal(pageIndex, id);
    return Comlink.transfer(r, [r.bytes.buffer]);
  },
};

Comlink.expose(api);
