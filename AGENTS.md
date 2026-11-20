# AGENTS.md

Rules for coding agents that work on this repository.

## What the app is

A static, client-side web app. It prepares client .ai and PDF files for CorelDRAW. Refer to `README.md` and `docs/architecture.md`.

## Commands

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Development server | `npm run dev` |
| Type check | `npm run typecheck` |
| Unit tests | `npm test` |
| Build and check limits | `npm run build` |
| Serve the build | `npm run preview` |
| End-to-end tests | `SAMPLES_DIR=/path/to/samples npm run test:e2e` |
| Audit | `npm audit` and `npm audit --omit=dev` |

Run `npx playwright install chromium` one time before the first end-to-end run.

The end-to-end tests use port 4173. Set `E2E_PORT` to use a different port.

## Structure

- `src/pdf/`: pdf-lib code. It runs in the PDF worker only. Do not import it from `src/ui/` or `src/viewer/`, except `src/pdf/content/geometry.ts`, which has no pdf-lib import.
- `src/pdf/content/`: tokenizer, geometry, element model and emitter.
- `src/worker/`: worker entry point.
- `src/ui/`: main-thread user interface. Plain TypeScript and DOM code. Do not add a UI framework.
- `src/style.css`: Tailwind CSS v4 entry. Colour tokens, dark mode and shared utilities.
- `src/viewer/`: the artboard viewer and selection logic.
- `src/shared/`: types and constants for both threads. Keep these files free of imports from pdf-lib and the DOM.
- `tests/unit/`: Vitest tests. They make small PDFs in memory (`tests/unit/fixtures.ts`).
- `tests/e2e/`: Playwright tests. They run against `vite preview`.
- `scripts/`: build helper scripts.
- `public/_headers`: production HTTP headers, including the CSP.

## Conventions

- Use TypeScript strict mode. Do not use `any` in `src/`. `npm run typecheck` must pass.
- Keep the main thread for user interface work. Put PDF parsing and export in the worker.
- Transfer large buffers between threads with `Comlink.transfer`. Do not copy them.
- Do not add requests to other hosts. The CSP allows `'self'` only.
- Do not add inline scripts, inline styles in HTML, `eval` or WASM. They break the CSP. If you must add WASM, update the CSP, `docs/deployment.md` and `docs/architecture.md`, and record the reason.
- Pin dependency versions exactly. Commit `package-lock.json`. Run `npm audit` after each dependency change.
- Keep the UserUnit of pages as it is. CorelDRAW imports these PDFs at the correct size.
- Style with Tailwind utility classes. Use the theme tokens (`bg-card`, `text-muted-foreground`, `border-border`) and not fixed colours. Then light and dark mode both work.
- Write full class names in the source. Tailwind does not find class names that code builds from parts.
- Add a utility to `src/style.css` only if many elements use it.
- Keep state in `data-*` or `aria-*` attributes. Do not use style classes for state.
- Give each icon-only button an `aria-label` and a `data-tip` tooltip.
- Add a `data-testid` to each element that a test uses. Use it in the tests, not style classes.

## Test rules

- Never commit client files or files made from them. This includes .ai, .pdf and .eps files, exported PDFs, PNG files and screenshots. `.gitignore` blocks the common types.
- Unit tests must use synthetic PDFs that the tests make in memory.
- End-to-end tests read the sample files from `SAMPLES_DIR`. They skip a test if its file is missing.
- End-to-end downloads go to `E2E_OUT` (default `test-results/downloads`). `test-results/` is not committed.

## How to verify a change

1. Run `npm run typecheck`.
2. Run `npm test`.
3. Run `npm run build`. Make sure that the check line shows fewer than 1000 files and no file of 25 MiB or more.
4. Run `SAMPLES_DIR=... npm run test:e2e`.
5. If the change affects export, compare the new output with the last good output. Use `pdfinfo -box`, `pdfimages -list`, `pdffonts` and `pdftoppm`. The page boxes, the image list and the rendered pages must be the same.
6. If the change affects the viewer, look at the screenshots in `test-results/`.
7. If the change affects the user interface, look at it in light and dark mode.

## Documentation style

Write all documentation in ASD-STE100 Simplified Technical English:

- Use short sentences: 20 words or fewer in procedures, 25 words or fewer in descriptions.
- Write one instruction in each sentence.
- Use the active voice.
- Use the imperative in procedures.
- Use simple, approved words. Use one word for one meaning.
- Do not use idioms, marketing language or filler.
- Do not use em dashes or emoji.
