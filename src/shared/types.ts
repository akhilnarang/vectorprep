/** Data that crosses the worker boundary. All plain, structured-cloneable values. */

export type Box = [number, number, number, number]; // x0, y0, x1, y1 in PDF user space

export type PageStatus = 'vector' | 'raster' | 'huge' | 'fonts' | 'pixel' | 'traced';

export interface ImageInfo {
  name: string;
  w: number;
  h: number;
  mp: number;
  bpc: number | null;
  cs: string;
  alpha: boolean;
  filter: string;
  uses: number;
}

export interface FontInfo {
  name: string;
  subtype: string;
  embedded: boolean;
}

/** A pixel image that was converted into one rectangle for each pixel (or run of pixels). */
export interface PixelArt {
  /** filled axis-aligned rectangles */
  rects: number;
  /** common size of one pixel, in page units (pt before UserUnit) */
  unitPt: number;
  /** estimated size of the source image in pixels */
  srcW: number;
  srcH: number;
  /** effective resolution at the real size (UserUnit applied) */
  dpi: number;
}

/** Counts and flags from the artwork checks of one artboard (src/pdf/artwork.ts). */
export interface ArtworkCheck {
  /** path construction and painting operators, forms included */
  drawOps: number;
  fills: number;
  strokes: number;
  curvedFills: number;
  /** distinct fill colours */
  colours: number;
  rects: number;
  text: number;
  shadings: number;
  patterns: number;
  forms: number;
  /** decoded content bytes read */
  bytes: number;
  /** a limit stopped the scan before the end */
  partial: boolean;
  /** scan time in ms */
  ms: number;
  pixel: PixelArt | null;
  /** looks like an image that was traced into flat-colour shapes */
  traced: boolean;
  /** more than MANY_OBJECTS drawing operations or filled paths */
  many: boolean;
}

export interface PageReport {
  index: number;
  wPt: number;
  hPt: number;
  userUnit: number;
  rotation: number;
  images: ImageInfo[];
  fonts: FontInfo[];
  totalMP: number;
  huge: boolean;
  status: PageStatus;
  artwork: ArtworkCheck | null;
}

export type OpenError = 'no-pdf-compat' | 'not-pdf' | 'encrypted';

export interface OpenTimings {
  read: number;
  parse: number;
  analyse: number;
  /** artwork checks of all pages, included in `analyse` */
  artwork: number;
}

export type OpenResult =
  | { error: OpenError }
  | {
      error?: undefined;
      header: { offset: number; version: string };
      pages: PageReport[];
      creator: string | null;
      producer: string | null;
      isIllustrator: boolean;
      timings: OpenTimings;
    };

export type ElementKind = 'root' | 'block' | 'path' | 'image' | 'form' | 'text' | 'shading' | 'inline';

/** One selectable element, as sent to the viewer. */
export interface ElementDTO {
  id: number;
  /** parent id, -1 for the root */
  p: number;
  k: ElementKind;
  /** bounds in PDF user space, null when nothing is visible */
  b: Box | null;
  /** bounds are approximate */
  a: boolean;
  /** invisible (fully transparent, empty or clipped away) */
  inv: boolean;
  /** child ids for containers, null for leaves */
  ch: number[] | null;
  /** human-readable label */
  n: string;
}

export interface ElementTreeDTO {
  nodes: ElementDTO[];
  pbox: Box;
  userUnit: number;
  ms: number;
  ops: number;
}

export interface ElementPdfOptions {
  marginMm?: number;
  title?: string;
}

export interface ElementPdfResult {
  bytes: Uint8Array;
  box: Box;
  sizePt: [number, number];
  userUnit: number;
  warnings: string[];
  count: number;
}

export interface ImageResult {
  bytes: Uint8Array;
  ext: 'png' | 'jpg' | 'jp2';
  width: number;
  height: number;
  name: string;
  note: string;
}

/** API exposed by the PDF worker (see src/worker/pdf.worker.ts). */
export interface PdfWorkerApi {
  open(file: Blob | Uint8Array, name: string, progress?: (msg: string) => void): Promise<OpenResult>;
  exportPdf(indices: number[], title?: string): Promise<Uint8Array>;
  elements(pageIndex: number): Promise<ElementTreeDTO>;
  elementPdf(pageIndex: number, ids: number[], opts?: ElementPdfOptions): Promise<ElementPdfResult>;
  imageOriginal(pageIndex: number, id: number): Promise<ImageResult>;
}
