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
| `src/pdf/artwork.ts` | Artwork checks: "Pixel image as vectors", "Traced image" and "Many objects". |
| `src/pdf/content/tokenizer.ts` | Content-stream tokenizer. |
| `src/pdf/content/scan.ts` | Counting pass over a content stream for the artwork checks. |
| `src/pdf/content/geometry.ts` | Matrices and boxes. |
| `src/pdf/content/elements.ts` | Element model: builds the element tree with bounding boxes. |
| `src/pdf/content/emit.ts` | Writes selected elements as a new content stream. |
| `src/pdf/export.ts` | Cleaning, artboard export and element export. |
| `src/pdf/image.ts` | Decodes embedded images and writes PNG files. |
| `src/pdf/flate.ts` | Flate compression with the browser `CompressionStream`. |
| `src/shared/types.ts` | Types for data that goes between the threads. |
| `src/shared/constants.ts` | Limits, for example the 50 MP "huge raster" limit and the artwork check thresholds. |

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
   |                                          checkArtwork() per page
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

## Artwork checks

The artwork checks find "fake vector" files. These files look like vector artwork, but they are raster images that a program converted. The checks run in the PDF worker when the file opens, one time for each artboard. The results go to the main thread in the page report (`PageReport.artwork`).

### Counting pass

The checks do not use the element model. The tokenizer makes one object for each operand, and the element model makes one node for each path. For a 4 MB stream with 250,000 operators, this takes 300 ms to 450 ms. The checks need counts only.

`scanContent` in `src/pdf/content/scan.ts` reads the decoded bytes one time. It does not make tokens or strings. It keeps this state:

- The CTM and the fill colour, with a stack for `q` and `Q`.
- The current path: the number of subpaths, and whether it has curves.
- The axis-aligned rectangles of the current path. A rectangle is a `re` operator, or a subpath of `m` and three or four `l` operators with only horizontal and vertical edges. A fill adds the rectangles to a histogram of widths and heights in page space. A stroke or a clip (`n`) discards them.

It counts the drawing operators (path construction and painting), the fills, the strokes, the filled paths with curves, the distinct fill colours, text objects (`BT`), shadings (`sh`), pattern fills, images and forms.

`scanPage` in `src/pdf/artwork.ts` scans the page content. For each `Do` of a form XObject, it scans the form content with the form matrix and the current CTM. It goes down eight levels and does not scan a form inside itself. It keeps the decoded form streams in a cache for all pages of the document. It reads at most 128 MiB of decoded content for each artboard. At this limit, it stops and marks the result as partial.

### Rules and thresholds

The thresholds are in `src/shared/constants.ts`. `classifyArtwork` in `src/pdf/artwork.ts` applies them.

**Pixel image as vectors.** All of these conditions must be true:

| Condition | Threshold | Reason |
| --- | --- | --- |
| Filled axis-aligned rectangles | 5,000 or more | The sample has 247,535. A QR code or a pattern of tiles has some hundreds. |
| Rectangles as a share of the filled subpaths | 80% or more | The rectangles are the artwork, not a detail of it. The sample has 100%. |
| Common unit | A size that is 5% or more of all widths and heights. 90% or more of the widths, and 90% or more of the heights, are whole multiples of it (tolerance 3%). The smallest such size is the unit. | Converters write one row of pixels, or a run of pixels with the same colour, as one rectangle. So the heights are often 1 unit, and the widths are whole multiples. In the sample, the unit is 1 pt. |
| Source image size | 64 px or more on the longer side | A smaller grid is not a photo or a logo. |

The tool estimates the source image size as the box of the rectangles divided by the unit. The resolution at the real size is `72 / (unit × UserUnit)` dpi.

**Traced image.** The artboard is not "Pixel image as vectors", and all of these conditions are true:

| Condition | Threshold | Reason |
| --- | --- | --- |
| Filled paths | 500 or more | The traced sample has 1,823. The normal samples have 409 or fewer. |
| Distinct fill colours | 16 or more | The traced sample has 30. The normal samples have 6 or fewer. A logo usually has few colours. |
| Filled paths with curves | 50% or more of the fills | Image Trace makes curved outlines. The sample has 81%. |
| Strokes | 2% of the fills or fewer | Image Trace makes fills only. |
| Text objects, shadings and pattern fills | 0 | Image Trace does not make text or gradients. |

The first plan was a high ratio of distinct colours to fills. The traced sample does not agree with this plan: it has 30 colours in 1,823 fills (1.6%). Illustrator Image Trace limits the palette. Thus the rule uses a minimum number of colours.

**Many objects.** More than 50,000 drawing operations or more than 50,000 filled paths on one artboard. CorelDRAW becomes slow with this quantity of objects and path nodes. This flag can show together with the other two.

### Results on the sample files

| Sample | Drawing operations | Fills | Colours | Rectangles | Result |
| --- | --- | --- | --- | --- | --- |
| Converted pixel logo (1 artboard) | 247,789 | 254 | 254 | 247,535 (unit 1 pt) | Pixel image as vectors: about 1288 × 762 px, 72 dpi. Many objects. |
| Image Trace logo (1 artboard, 1 form) | 24,085 | 1,823 | 30 | 13 | Traced image |
| Event branding .ai (9 artboards) | 2,147 to 5,936 | 5 to 409 | 2 to 6 | 10 to 89 | No flags |
| Canva crest PDF (3 forms) | 11,011 | 334 | 3 | 8 | No flags (it also has text) |

### Status and selection

The page status has two new values: `pixel` and `traced`. The order is `huge`, `fonts`, `pixel`, `traced`, `raster`, `vector`. The first match is the main badge. The card shows the other flags as more badges. The card has a `data-flags` attribute, for example `pixel many`.

The checks do not change the selection. The flagged artboards stay selected. The reasons are:

- Often the flagged artwork is the only artwork of the job. The user must export it, or ask the client for a better file.
- The export does not make the artwork worse. CorelDRAW can open it.
- The "Large raster" artboards are different. They are usually overview boards that the job does not need, and they can stop CorelDRAW.

The notes explain the problem and what to ask the client for.

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
| Artwork checks, 158 MB file, 9 artboards (1.3 MB of content) | 9 ms |
| Artwork checks, Canva PDF (0.58 MB of content, 3 forms) | 6 ms |
| Artwork checks, Image Trace logo (0.58 MB form) | 3 ms to 6 ms |
| Artwork checks, converted pixel logo (4.0 MB stream, 247,789 operators) | 65 ms |
| Of this: inflate of the 4.0 MB stream (pdf-lib, JavaScript) | 32 ms |
| Of this: counting pass | 42 ms (warm: 28 ms) |
| For comparison: tokenizer only, same stream | 315 ms |
| For comparison: element tree, same stream | 446 ms |
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

Artwork checks in the browser (Chromium, `vite preview`, median of 3 loads). The "report" time is from file selection to the visible report. The worker runs the checks, so the longest main-thread pause did not change.

| File | Checks in the worker | Report before | Report after | Longest main-thread pause, before and after |
| --- | --- | --- | --- | --- |
| Converted pixel logo (4.0 MB stream) | 93 ms | 29 ms | 123 ms | 58 ms, 66 ms |
| Image Trace logo | 21 ms | 35 ms | 56 ms | 21 ms, 31 ms |
| 158 MB event branding file | 33 ms | 140 ms | 168 ms | 161 ms, 164 ms |
| Canva PDF | 19 ms | 32 ms | 50 ms | 23 ms, 23 ms |

The browser times are larger than the Node.js times because the worker starts new for each file and its code is not optimized yet.

### Why there is no WASM

The profile shows no JavaScript hotspot that needs WASM:

- Parsing, the element model and export take 4 ms to 50 ms each. They run in the worker, so the user interface does not stop.
- The largest JavaScript cost is the PNG row filter of a 17 MP image: about 190 ms. It runs one time, when the user asks for the original image. Native `CompressionStream` and `DecompressionStream` already do the compression work.
- WASM would add a build step, a larger download and the `'wasm-unsafe-eval'` CSP keyword.

For the same CSP reason, pdf.js runs with `useWasm: false`. pdf.js then uses its JavaScript code paths.
