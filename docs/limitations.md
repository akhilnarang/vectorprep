# Limitations and planned work

## Known limits

### Files

- The tool reads only .ai files that have PDF compatibility, and PDF files. It cannot read .ai files without PDF compatibility, or EPS files.
- The tool does not open encrypted or password-protected PDFs.
- The PDF worker keeps the whole file in memory. The memory use was not measured. Very large files can fail on computers with little memory.
- The tool needs a current browser. pdf.js 6 uses new JavaScript features, for example `Math.sumPrecise`. Older browsers show warnings, and some drawings can fail.
- The tool was tested in Chromium only.

### Fonts

- The tool cannot convert live text to outlines. It shows a warning only.
- The report lists the fonts in the page resources. A font that is in the resources but not used is also listed.

### Report

- The "Large raster" limit is 50 MP for the sum of the images on one artboard.
- The report does not find inline images (`BI ... EI` in the content stream). They do not count toward the 50 MP limit.
- Images in annotation appearance streams are not counted.

### Artwork checks

The "Pixel image as vectors" and "Traced image" checks use counts from the content stream. They do not look at the rendered artwork. They can be wrong.

Possible false positives (the tool shows a flag, but the artwork is good vector artwork):

- A large pattern of squares or tiles with 5,000 or more filled rectangles on a common size, for example a mosaic, a large QR code or a pixel-art design. The tool shows "Pixel image as vectors".
- Detailed drawn artwork with 500 or more curved fills in 16 or more flat colours, and no strokes, text or gradients. For example, an illustration with many flat colours. The tool shows "Traced image".

Possible false negatives (the artwork is a converted image, but the tool shows no flag):

- A pixel image that was converted with rotated or skewed rectangles, with other shapes than rectangles (for example circles), or with rectangles that are mostly stroked and not filled.
- A pixel image with fewer than 5,000 rectangles, or a grid smaller than 64 pixels.
- A traced image with fewer than 500 shapes, fewer than 16 colours, mostly straight edges, strokes, or a gradient or text added after the trace. Black-and-white traces have 1 or 2 colours, so the tool does not flag them.
- A traced or converted image inside a tiling pattern, a soft mask, a Type 3 font or an annotation. The checks do not read these.
- Form XObjects deeper than eight levels.

Other limits:

- The tool counts the colours by their values in the content stream. The same colour in two colour spaces counts as two colours. The tool does not read the colour values of a pattern or a Separation colour.
- The source image size is an estimate. It is the box of all rectangles divided by the pixel size. A transparent border in the source image is not included.
- The "Many objects" limit counts content-stream operators, not CorelDRAW objects. One filled path with many subpaths counts as many operations. CorelDRAW can be slow with fewer objects than the limit.
- The checks read at most 128 MiB of decoded content for each artboard. After this limit, the card shows that the tool checked only part of the content.
- The checks run in the worker when the file opens. On the development computer, a 4 MB content stream adds about 90 ms to the time before the report shows.

### Previews and viewer

- pdf.js does not draw images larger than 50 MP. The viewer shows the vector parts of a "Large raster" artboard only.
- pdf.js runs without WASM because of the CSP. Colour management with ICC profiles is not used in previews. CMYK colours in previews are approximate.
- The preview of JPEG 2000 and JBIG2 images uses the pdf.js JavaScript fallback. These images were not tested.

### Element selection and export

- Text bounds are estimates (0.6 em for each glyph). Shading bounds use the clip box. The tool marks these bounds with "≈". The page of an element export can then have extra space.
- The model reads form XObjects to a depth of four levels. Deeper content can be selected only as one form.
- Tiling patterns, soft masks and Type 3 fonts are copied as they are. You cannot select parts of them.
- Element export drops marked content (layers and tags). A hidden layer in the source is visible in the exported element.
- A selection inside an annotation is not possible. Annotations are not exported with elements.
- An original-image export is not possible for images larger than 100 MP. JPEG and JPEG 2000 images with masks, JBIG2 and CCITT images, and Separation or DeviceN colour are not supported. Use the PNG export for these images.
- CMYK images are converted to RGB with a simple formula in the original-image export.
- The PNG export is limited to 16,384 pixels on a side and 150 MP. The tool reduces the resolution if necessary and tells you.

### Tooling

- `npm audit` reports a high-severity advisory (GHSA-fc5q-39xc-vjpf, ReDoS) in `picomatch` 4.0.7. Vite, Vitest and tinyglobby use `picomatch` at build time. No fixed version of `picomatch` is available. The advisory does not affect the deployed app: `npm audit --omit=dev` reports 0 vulnerabilities, and `dist/` contains no `picomatch` code. Update the development dependencies when a fixed version is released.

## Planned work

### Font outlining with Ghostscript WASM

The plan is to convert live text to outlines in the browser with a WASM build of Ghostscript (`gs -dNoOutputFonts -sDEVICE=pdfwrite`).

Points to check before this work starts:

- **Licence.** Ghostscript is available under the GNU Affero General Public License version 3 (AGPL-3.0) or under a commercial licence from Artifex. The public web app sends the WASM file to the browser of each user. This is a distribution of Ghostscript. Under the AGPL, the complete source code of the combined work must be available to all users under the AGPL. This includes the code of this app if the app and Ghostscript form one program. The other possibility is to buy a commercial licence from Artifex. Get a legal decision before you add Ghostscript.
- **Isolation.** If the AGPL is used, keep Ghostscript in a separate module that loads only when the user asks for outlining. Show a link to the source code in the app.
- **CSP.** WASM needs the `'wasm-unsafe-eval'` keyword in `script-src`. Update `public/_headers` and `docs/deployment.md`.
- **Size.** Ghostscript WASM builds are typically 15 MB to 20 MB. Check the size of the actual build against the 25 MiB file limit of Cloudflare Pages. Load the file only when the user asks for outlining.
- **Quality.** `pdfwrite` writes the file again. Check colours, transparency, overprint and UserUnit after the conversion.

### Other planned work

- Detect inline images and count them in the report.
- Better text bounds with the font widths.
- Show layers (optional content groups) and let the user include or exclude them in an export.
- Export several artboards with element selections in one step.
