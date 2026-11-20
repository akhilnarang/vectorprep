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
