// Copy pdf.js runtime data (CMaps, standard fonts, no-WASM image decoder fallbacks) into public/pdfjs/.
// These files come from node_modules, so they are not committed (see .gitignore).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');
rmSync(dest, { recursive: true, force: true });
mkdirSync(join(dest, 'wasm'), { recursive: true });
cpSync(join(src, 'cmaps'), join(dest, 'cmaps'), { recursive: true });
cpSync(join(src, 'standard_fonts'), join(dest, 'standard_fonts'), { recursive: true });
for (const f of ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js', 'LICENSE_OPENJPEG', 'LICENSE_JBIG2', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_PDFJS_JBIG2']) {
  cpSync(join(src, 'wasm', f), join(dest, 'wasm', f));
}
cpSync(join(src, 'LICENSE'), join(dest, 'LICENSE'));
console.log('pdf.js assets copied to public/pdfjs/');
