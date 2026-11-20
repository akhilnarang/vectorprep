import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

/** Read the global ("/*") block of public/_headers so `vite preview` serves the same headers as Cloudflare. */
function headersFromFile(): Record<string, string> {
  const out: Record<string, string> = {};
  let inGlobal = false;
  for (const line of readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      inGlobal = line.trim() === '/*';
      continue;
    }
    const m = /^\s+([^:]+):\s*(.*)$/.exec(line);
    if (inGlobal && m) out[m[1]!] = m[2]!;
  }
  return out;
}

export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  build: {
    target: 'es2023',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
  worker: { format: 'es' },
  preview: { headers: headersFromFile() },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
