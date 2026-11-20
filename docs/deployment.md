# Deployment

The app is a set of static files. You deploy it to Cloudflare Pages with a direct upload from the dashboard. You do not need Wrangler.

## 1. Build

1. Install the dependencies:

   ```sh
   npm ci
   ```

2. Run the tests:

   ```sh
   npm test
   ```

3. Build the app:

   ```sh
   npm run build
   ```

The build does these steps:

1. It copies the pdf.js data files (CMaps, standard fonts and decoder fallbacks) to `public/pdfjs/`.
2. It runs the TypeScript type check.
3. It writes the app to `dist/`.
4. It runs `scripts/check-dist.mjs`. The script stops the build if `dist/` has 1000 or more files, if a file is 25 MiB or larger, or if `dist/_headers` is missing.

The last line of the build output shows the number of files, the total size and the largest file. A typical result is 198 files and 4.7 MiB. The largest file is about 1.2 MiB.

## 2. Check the build locally

1. Start the preview server:

   ```sh
   npm run preview
   ```

2. Open `http://localhost:4173`.
3. Open a PDF file. Make sure that the report and the previews show.

The preview server sends the same headers as the `public/_headers` file. Open the browser developer tools. Make sure that the console shows no "Content Security Policy" errors.

## 3. Upload to Cloudflare Pages

Do these steps the first time:

1. Log in to the Cloudflare dashboard.
2. Go to **Workers & Pages**.
3. Click **Create**. Select the **Pages** tab.
4. Select **Use direct upload** (the label can also be **Upload assets**).
5. Type a project name, for example `vectorprep`. Click **Create project**.
6. Drag the `dist` folder onto the upload area. As an alternative, make a .zip file of the contents of `dist` and drag the .zip file.
7. Click **Deploy site**.
8. Wait until the dashboard shows "Success". Then open the `*.pages.dev` address.

Do these steps for an update:

1. Build the app again (section 1).
2. In the dashboard, open the project.
3. Click **Create deployment** (the label can also be **Create new deployment**).
4. Drag the `dist` folder onto the upload area.
5. Click **Save and deploy**.

Upload the contents of `dist` only. Do not upload the repository, `node_modules` or any client files.

## 4. Headers and CSP

The file `public/_headers` is copied to `dist/_headers`. Cloudflare Pages reads it and adds these headers to all responses:

| Header | Value | Reason |
| --- | --- | --- |
| `Content-Security-Policy` | Refer to the next table. | Lets the page load code only from its own origin. |
| `X-Content-Type-Options` | `nosniff` | Stops MIME type guessing. |
| `Referrer-Policy` | `no-referrer` | Sends no referrer to other sites. |
| `Permissions-Policy` | Camera, microphone, location, payment, USB and sensors off | The app does not use these features. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolates the window from other sites. |
| `X-Frame-Options` | `DENY` | Stops other sites from showing the app in a frame. |

The files in `/assets/` also get a long cache time. Their names contain a content hash, so a new build gets new names.

The Content Security Policy has these directives:

| Directive | Value | Reason |
| --- | --- | --- |
| `default-src` | `'self'` | Only the app origin. |
| `script-src` | `'self'` | No inline scripts, no `eval`, no WASM. |
| `style-src` | `'self'` | No inline style sheets. |
| `img-src` | `'self' blob: data:` | Downloads and canvas images use `blob:` URLs. |
| `font-src` | `'self'` | No external fonts. |
| `connect-src` | `'self'` | pdf.js loads its data files from the app origin. |
| `worker-src` | `'self' blob:` | The PDF worker and the pdf.js worker. |
| `object-src` | `'none'` | No plug-ins. |
| `base-uri` | `'none'` | No `<base>` element. |
| `form-action` | `'none'` | The app has no forms that send data. |
| `frame-ancestors` | `'none'` | No framing. |

The app makes no requests to other hosts.

## 5. Check the deployment

1. Open the `*.pages.dev` address.
2. Open the browser developer tools. Select the **Network** tab.
3. Reload the page.
4. Select the document request. Make sure that the response has the `Content-Security-Policy` header.
5. Open a sample PDF file. Make sure that the report and the previews show.
6. Open the viewer. Select an element. Download it as a vector PDF.
7. Make sure that the **Console** tab shows no "Content Security Policy" errors.
8. Make sure that the **Network** tab shows no requests to other hosts. File data is not uploaded.
