# VectorPrep

This tool prepares client Illustrator (.ai) and PDF files for CorelDRAW.
It runs in the browser. It does not send files to a server.

The tool does these tasks:

- It reads an .ai file that has PDF compatibility, or a PDF file.
- It shows a report for each artboard (page): size, raster images, fonts and a status badge.
- It finds artboards with very large raster images and does not select them by default.
- It finds "fake vector" artwork: pixel images converted into vector rectangles, and images that look traced. It also warns about artboards with very many objects.
- It exports the selected artboards as one clean PDF, as one PDF for each artboard, or as a .zip file.
- It removes Illustrator private data from the exported PDFs.
- It shows each artboard in a viewer with zoom and pan.
- It lets you select single elements in the viewer and download them as a vector PDF, a PNG, or the original embedded image.
- It follows the light or dark setting of the operating system.

The user interface uses plain TypeScript and Tailwind CSS v4. It does not use a UI framework.

## Quick start

You need Node.js 22.13 or later (Node.js 24 is recommended) and npm.

1. Install the dependencies:

   ```sh
   npm ci
   ```

2. Start the development server:

   ```sh
   npm run dev
   ```

3. Open the address that Vite shows, for example `http://localhost:5173`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Copies the pdf.js data files and starts the development server. |
| `npm run typecheck` | Runs `tsc --noEmit` (strict mode). |
| `npm run build` | Copies the pdf.js data files, runs the type check, builds `dist/` and checks the file limits. |
| `npm run preview` | Serves `dist/` on port 4173 with the same headers as production. |
| `npm test` | Runs the unit tests (Vitest). The tests use small PDFs that the tests make. |
| `npm run test:e2e` | Builds the app, starts `vite preview` and runs the Playwright tests. |

The end-to-end tests need two sample files. Put them in a folder outside the repository. Use these file names:

| File name | Content |
| --- | --- |
| `sample-multi-artboard.ai` | An Illustrator file with 9 artboards. Artboard 9 has very large raster images. |
| `sample-live-fonts.pdf` | A one-page PDF with live (not outlined) text. |

The tests look for the files in `../vectorprep-samples`. To use a different folder, set `SAMPLES_DIR`:

```sh
SAMPLES_DIR=/path/to/samples npm run test:e2e
```

You can use symbolic links to the real files.

If a sample file is missing, the tests that need it are skipped. Do not add client files to the repository.

The tests use port 4173. To use a different port, set `E2E_PORT`:

```sh
E2E_PORT=4391 SAMPLES_DIR=/path/to/samples npm run test:e2e
```

Before the first end-to-end run, install the browser:

```sh
npx playwright install chromium
```

## Deploy

The build output in `dist/` is a set of static files. To deploy, drag the `dist` folder onto the Cloudflare Pages dashboard. Refer to [docs/deployment.md](docs/deployment.md).

## Documentation

- [User guide](docs/user-guide.md): how to use the tool, and what to do when a file fails.
- [Architecture](docs/architecture.md): modules, data flow, the element model, export, and performance.
- [Deployment](docs/deployment.md): build, upload to Cloudflare Pages, headers, and checks.
- [Limitations](docs/limitations.md): known limits and planned work.
- [AGENTS.md](AGENTS.md): rules for coding agents that work on this repository.
