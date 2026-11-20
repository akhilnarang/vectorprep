// Check the static build for Cloudflare Pages direct upload: < 1000 files, each < 25 MiB, _headers present.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const LIMIT = 25 * 1024 * 1024;
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push({ path: relative(dist, p), size: statSync(p).size });
  }
};
walk(dist);
let ok = true;
const big = files.filter((f) => f.size >= LIMIT);
if (big.length) { ok = false; console.error('Files of 25 MiB or more:', big); }
if (files.length >= 1000) { ok = false; console.error(`Too many files: ${files.length} (limit 999)`); }
if (!existsSync(join(dist, '_headers'))) { ok = false; console.error('dist/_headers is missing'); }
const total = files.reduce((s, f) => s + f.size, 0);
const largest = files.sort((a, b) => b.size - a.size)[0];
console.log(`dist: ${files.length} files, ${(total / 1048576).toFixed(2)} MiB total, largest ${largest.path} ${(largest.size / 1048576).toFixed(2)} MiB`);
if (!ok) process.exit(1);
