# Architecture

## Overview

The app is a static single-page application. It is written in TypeScript (strict mode) and built with Vite. All PDF work happens in the browser.

The app uses these libraries:

| Library | Use |
| --- | --- |
| `@cantoo/pdf-lib` | Reads, changes and writes PDF objects. Runs in the PDF worker. |
| `pdfjs-dist` | Draws previews, the viewer and PNG exports. Has its own worker. |
| `comlink` | Calls the PDF worker from the main thread. |
| `jszip` | Makes the .zip file of per-artboard PDFs. |
| `tailwindcss`, `@tailwindcss/vite` | Build tool only. Makes the CSS file from the utility classes. It adds no JavaScript to the app. |

`@cantoo/pdf-lib` is a maintained fork of `pdf-lib`. The original `pdf-lib` had its last release (1.17.1) in 2021. The fork has the same API, current releases and fixes.

## Threads

The app uses three threads:

1. The main thread. It runs the user interface only.
2. The PDF worker (`src/worker/pdf.worker.ts`). It runs all pdf-lib work: parsing, inspection, the element model, export and image decoding.
3. The pdf.js worker. pdf.js uses it to parse the PDF for drawing.

## Modules

| Path | Purpose |
| --- | --- |
| `src/main.ts` | Entry point. Loads the styles, adds the icons and starts the app. |
| `src/style.css` | Tailwind entry: colour tokens, light and dark mode, and shared utilities. |
| `src/ui/icons.ts` | Line icons as SVG elements. Replaces the `<i data-icon>` placeholders in `index.html`. |
| `src/ui/app.ts` | Page controller: file loading, report, artboard export, drag and drop. |
| `src/ui/report.ts` | Artboard cards, notes and file names. |
| `src/ui/thumbs.ts` | Lazy previews with `IntersectionObserver`. |
| `src/ui/pdfjs.ts` | pdf.js set-up and the range transport. |
| `src/ui/backend.ts` | Starts the PDF worker and wraps it with Comlink. |
| `src/ui/dom.ts`, `src/ui/perf.ts` | DOM helpers, status messages and timing marks. |
| `src/viewer/viewer.ts` | Viewer: zoom, pan, rendering, overlay, selection panel, element downloads. |
| `src/viewer/tree.ts` | Selection logic on the element tree: hit test, drill-down, marquee, parent and children. |
| `src/worker/pdf.worker.ts` | Worker entry point. Exposes `PdfSession` through Comlink. |
| `src/pdf/session.ts` | One open document, its cleaning state and its cached element trees. |
| `src/pdf/inspect.ts` | Page report: sizes, UserUnit, images, fonts, status. |
| `src/pdf/content/tokenizer.ts` | Content-stream tokenizer. |
| `src/pdf/content/geometry.ts` | Matrices and boxes. |
| `src/pdf/content/elements.ts` | Element model: builds the element tree with bounding boxes. |
| `src/pdf/content/emit.ts` | Writes selected elements as a new content stream. |
| `src/pdf/export.ts` | Cleaning, artboard export and element export. |
| `src/pdf/image.ts` | Decodes embedded images and writes PNG files. |
| `src/pdf/flate.ts` | Flate compression with the browser `CompressionStream`. |
| `src/shared/types.ts` | Types for data that goes between the threads. |
| `src/shared/constants.ts` | Limits, for example the 50 MP "huge raster" limit. |

## User interface and styles

The user interface is plain TypeScript and DOM code. It does not use React or another UI framework.

The styles use Tailwind CSS v4. The `@tailwindcss/vite` plugin reads the class names in `index.html` and `src/**/*.ts`. It writes one CSS file to `dist/assets/`. The page has no inline styles, so the CSP `style-src 'self'` stays the same. Code can set `element.style` for transforms and sizes. The CSP permits this.

`src/style.css` holds these items:

- The colour tokens, for example `--background`, `--primary` and `--border`. They follow the neutral zinc look of shadcn/ui.
- A second set of tokens for dark mode. The `prefers-color-scheme` media query selects it.
- The `@theme` block. It makes the tokens available as utilities, for example `bg-card` and `text-muted-foreground`. It also sets the radius and the fonts.
- Shared utilities: `btn` with `btn-primary`, `btn-outline`, `btn-ghost` and the sizes `btn-sm`, `btn-xs`, `btn-icon`. Also `badge`, `alert`, `kbd`, `bg-checker`, `bg-stage`, and `tip` for tooltips.

Write all other styles as utility classes in the HTML or in the TypeScript that makes the element. Tailwind finds a class only if the full class name is in the source. Do not build class names from parts.

The app keeps state in attributes, not in style classes:

- `data-selected` on an artboard card.
- `data-compact` on the drop zone after a file opens.
- `data-kind` on a status message: `info`, `ok`, `warn` or `error`.
- `aria-pressed` on the viewer tool buttons.

The viewer keeps the `shown`, `hand`, `space` and `panning` classes. Arbitrary variants, for example `[&.shown]:visible`, style them.

Icon buttons have an `aria-label` and a `data-tip` tooltip. The tooltip shows on hover and on keyboard focus. When the viewer opens, the page behind it becomes `inert`. When the viewer closes, the focus goes back to the preview that opened it.

Elements that the tests use have a `data-testid` attribute.

## Data flow

```
 main thread                          PDF worker                      pdf.js worker
 -----------                          ----------                      -------------
 File (from drop or picker)
   | open(File)  ---- structured clone ---->  File.arrayBuffer()
   |                                          PDFDocument.load()
   |                                          analysePage() per page
   | <------------- report (plain data) ----
   |
   | pdf.js getDocument(range transport) ------------------------->  reads byte ranges
   |   File.slice(begin, end) on request  <--------------------------  of the File only
   |
 viewer open:
   | elements(page)  --------------------->  buildTree(page)
   | <------------- element tree (DTO) ----
   | page.render(visible area) ----------------------------------->  operator list
 export:
   | exportPdf(pages) -------------------->  cleanSource, copy pages, save
   | <------------- Uint8Array (transferred, not copied)
```

The main thread never reads the whole file. The PDF worker reads the `File` object itself. pdf.js reads only the byte ranges that it needs. Results from the worker come back as transferred `ArrayBuffer` objects, so the browser does not copy them.

## Content-stream element model

The element model is in `src/pdf/content/elements.ts`. It interprets a content stream one time and makes a tree of elements.

### Elements

These items become elements:

- A `q ... Q` block. It is a container. Illustrator writes each object or group in one block.
- A painted path: path construction operators, then a paint operator (`f`, `S`, `B` and the others).
- An image `Do`.
- A form `Do`. The model reads the form content and adds the form elements as children (up to four levels).
- A text object (`BT ... ET`).
- A shading (`sh`).
- An inline image (`BI ... EI`).

All other operators are "state": `cm`, `gs`, colours, line width, clipping paths (`W n`) and text state. Each container keeps an ordered list of items. An item is a group of state operators or one child element.

### Bounding boxes

The interpreter keeps the current transformation matrix (CTM) and a clip box. It does these steps:

- It transforms all path points, including Bézier control points, by the CTM. Control points make the box conservative.
- It adds half the line width (scaled by the CTM) to stroked paths.
- It intersects each box with the current clip box. A clip set with `W` has an effect after the paint operator, as the PDF specification says.
- It uses the unit square, transformed by the CTM, for images.
- It uses the form `BBox`, transformed by the form `Matrix` and the CTM, as the clip for form content.
- It estimates text boxes from the glyph count and the font size. These boxes are marked as approximate.
- It uses the clip box for shadings. These boxes are marked as approximate.

An element is invisible when its box is empty, or when the fill or stroke alpha (`ca`, `CA`) is 0. Invisible elements are not used for hit testing. Canva PDFs use invisible rectangles for tagging.

### Selection

`src/viewer/tree.ts` uses the element tree:

- The top level skips containers that have only one visible child container.
- A click selects the smallest top-level element under the pointer.
- Alt + click goes one level below the deepest selected element under the pointer.
- A marquee selects the largest elements that are fully inside the rectangle.

## Export

### Artboard export

`exportPages` in `src/pdf/export.ts` does these steps:

1. It removes private data from the source document in memory: page `/PieceInfo`, `/LastModified`, `/Thumb` and `/Metadata`, and form `/PieceInfo`. It also removes `/P` links in annotations and internal links. These links can pull other pages into the export.
2. It copies only the selected pages into a new document. Objects that the new pages do not use are not copied. The large images of an overview board are not copied.
3. It copies the catalog `/OCProperties`, so the layers stay correct.
4. It compresses streams that have no filter. Illustrator stores form XObjects without compression.
5. It saves with a classic cross-reference table, for older importers.

The page dictionaries are copied as they are. The UserUnit, the page boxes and the transparency group stay the same.

### Element export

`exportElements` writes a new PDF with one page:

1. It sorts the selected elements in paint order. It removes elements whose ancestor is also selected.
2. For each element, `emitNode` in `emit.ts` walks from the page root to the element. In each container it writes the state operators that come before the element. It writes `q` for each block. For each form it writes `q`, the form matrix (`cm`) and the form BBox clip. Then it writes the element.
3. If a skipped sibling changes state, the state is kept. For example, text state inside `BT ... ET`, or a clip that is set together with a fill.
4. It gives each used resource a new name. Resources from the page and from forms can have the same name, so new names prevent conflicts. Only used resources are copied.
5. It drops marked-content operators (`BDC`, `BMC`, `EMC`). Layer visibility does not apply to the extracted element.
6. It sets the page size to the selection box plus a 2 mm margin. It moves the content to the page origin. It keeps the UserUnit.

The PNG export renders this one-element PDF with pdf.js on a transparent canvas. The PNG then has only the selected elements.

The original-image export decodes the image XObject in the worker. It supports Flate with PNG predictors, RGB, grey, CMYK and Indexed colour, 1 to 16 bits, soft masks, stencil masks and ICC profiles. The PNG encoder is in `image.ts`. A JPEG or JPEG 2000 image without a mask is saved without change.

## Viewer rendering

The viewer uses two bitmaps:

- A base bitmap of the full artboard. Its longest side is 4096 pixels or less. CSS transforms move and scale it during zoom and pan. This is fast.
- A detail bitmap of the visible area only, at the current zoom. The viewer draws it 140 ms after the last zoom or pan. Its size is the size of the window, so a large artboard at 400% does not make a large canvas.

The viewer cancels a pdf.js render task when a new one starts.

pdf.js does not decode images larger than 50 MP (`maxImageSize`). This protects the browser from the 1000 MP images on overview boards.

## Performance

### Measurements

These numbers are from Node.js 24 on the development computer. The input is the 158 MB sample .ai file and the 244 KB Canva PDF. Each value is the median of 3 or 5 runs.

| Operation | Time |
| --- | --- |
| Open the 158 MB file: parse and analyse 9 pages | 40 ms |
| Element tree, artboard 1 (6,100 operators) | 20 ms |
| Element tree, artboard 7 (7,200 operators) | 16 ms |
| Element tree, Canva PDF (11,200 operators, 3 forms) | 49 ms |
| Tokenize 570 KB of content (11,080 operators) | 11 ms |
| Export artboards 1 to 8 | 35 ms |
| Element PDF (one logo) | 4 ms |
| Original image, 4110 × 4110 RGB, decode and PNG | 491 ms |
| Of this: native inflate (0.9 MB to 50.7 MB) | 97 ms |
| Of this: PNG encode (JS filter and native deflate) | 371 ms |
| Of this: native deflate of 50.7 MB | 179 ms |
| Original image, 2230 × 1092 Indexed with soft mask | 139 ms |

Browser measurements (Chromium 159, `vite preview`, the 158 MB file):

| Measurement | Phase 2 (plain JS) | Phase 3 (TypeScript) |
| --- | --- | --- |
| Report visible after file selection | 205 ms | 205 ms |
| First preview | 780 ms | 600 ms |
| First three previews | 1,210 ms | 725 ms |
| Export of artboards 1 to 8 | 78 ms | 78 ms |
| Longest main-thread pause during load | 50 to 60 ms | 65 ms |

### Why there is no WASM

The profile shows no JavaScript hotspot that needs WASM:

- Parsing, the element model and export take 4 ms to 50 ms each. They run in the worker, so the user interface does not stop.
- The largest JavaScript cost is the PNG row filter of a 17 MP image: about 190 ms. It runs one time, when the user asks for the original image. Native `CompressionStream` and `DecompressionStream` already do the compression work.
- WASM would add a build step, a larger download and the `'wasm-unsafe-eval'` CSP keyword.

For the same CSP reason, pdf.js runs with `useWasm: false`. pdf.js then uses its JavaScript code paths.
