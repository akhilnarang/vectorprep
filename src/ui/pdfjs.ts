/** pdf.js setup: previews and PNG rendering only. */
import * as pdfjsLib from 'pdfjs-dist';
import type { DocumentInitParameters, PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { HUGE_MP } from '../shared/constants';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

/** Shared options. WASM is off so the CSP needs no 'wasm-unsafe-eval'; giant images are never decoded. */
export const PDFJS_OPTS: DocumentInitParameters = {
  maxImageSize: HUGE_MP * 1e6,
  useWasm: false,
  wasmUrl: `${assets}wasm/`,
  cMapUrl: `${assets}cmaps/`,
  standardFontDataUrl: `${assets}standard_fonts/`,
};

export { pdfjsLib };
export type { PDFDocumentProxy };

/** Open a File via range requests, so a 150 MB file is never copied whole into pdf.js. */
export async function openPdfjsFile(file: Blob): Promise<PDFDocumentProxy> {
  const first = new Uint8Array(await file.slice(0, Math.min(file.size, 1 << 16)).arrayBuffer());
  const transport = new pdfjsLib.PDFDataRangeTransport(file.size, first);
  transport.requestDataRange = (begin: number, end: number) => {
    void file
      .slice(begin, end)
      .arrayBuffer()
      .then((b) => transport.onDataRange(begin, new Uint8Array(b)));
  };
  return pdfjsLib.getDocument({ ...PDFJS_OPTS, range: transport, rangeChunkSize: 1 << 18, disableAutoFetch: true, disableStream: true })
    .promise;
}

export function openPdfjsData(data: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({ ...PDFJS_OPTS, data }).promise;
}

export const isCancelled = (e: unknown): boolean => !!e && (e as { name?: string }).name === 'RenderingCancelledException';
