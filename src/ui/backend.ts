/** The PDF worker, wrapped with Comlink. */
import * as Comlink from 'comlink';
import type { PdfWorkerApi } from '../shared/types';

export type Backend = Comlink.Remote<PdfWorkerApi>;

export function createBackend(): Backend {
  const worker = new Worker(new URL('../worker/pdf.worker.ts', import.meta.url), { type: 'module', name: 'pdf-worker' });
  return Comlink.wrap<PdfWorkerApi>(worker);
}

export const proxy = Comlink.proxy;
