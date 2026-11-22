/**
 * Small line icons (24 × 24, stroke 2), drawn after the Lucide set (ISC licence).
 * index.html uses `<i data-icon="name"></i>` placeholders. `hydrateIcons()` replaces them at start-up.
 */
const SVGNS = 'http://www.w3.org/2000/svg';

type Shape = string | { c: [number, number, number] } | { r: [number, number, number, number, number] };

const ICONS = {
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4'],
  files: ['M20 7h-3a2 2 0 0 1-2-2V2', 'M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z', 'M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8'],
  archive: [{ r: [2, 3, 20, 5, 1] }, 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4'],
  lock: [{ r: [3, 11, 18, 11, 2] }, 'M7 11V7a5 5 0 0 1 10 0v4'],
  reset: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  info: [{ c: [12, 12, 10] }, 'M12 16v-4', 'M12 8h.01'],
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  error: [{ c: [12, 12, 10] }, 'm15 9-6 6', 'm9 9 6 6'],
  check: [{ c: [12, 12, 10] }, 'm9 12 2 2 4-4'],
  'chevron-left': ['m15 18-6-6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  pointer: ['M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.13 1.58a2 2 0 0 0-1.43 1.43l-1.58 6.13a.5.5 0 0 1-.95.06z'],
  hand: [
    'M18 11V6a2 2 0 0 0-4 0', 'M14 10V4a2 2 0 0 0-4 0v2', 'M10 10.5V6a2 2 0 0 0-4 0v8',
    'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  ],
  'zoom-in': [{ c: [11, 11, 8] }, 'm21 21-4.3-4.3', 'M11 8v6', 'M8 11h6'],
  'zoom-out': [{ c: [11, 11, 8] }, 'm21 21-4.3-4.3', 'M8 11h6'],
  fit: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  up: ['m18 15-6-6-6 6'],
  down: ['m6 9 6 6 6-6'],
  image: [{ r: [3, 3, 18, 18, 2] }, { c: [9, 9, 2] }, 'm21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21'],
  vector: [{ r: [16, 16, 6, 6, 1] }, { r: [2, 2, 6, 6, 1] }, 'M5 8v3a5 5 0 0 0 5 5h6', 'M8 5h3a5 5 0 0 1 5 5v6'],
  type: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
  grid: [{ r: [3, 3, 18, 18, 2] }, 'M3 9h18', 'M3 15h18', 'M9 3v18', 'M15 3v18'],
  keyboard: ['M10 8h.01', 'M12 12h.01', 'M14 8h.01', 'M16 12h.01', 'M18 8h.01', 'M6 8h.01', 'M7 16h10', 'M8 12h.01', { r: [2, 4, 20, 16, 2] }],
  github: [
    'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
    'M9 18c-4.51 2-5-2-7-2',
  ],
  layers: [
    'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
    'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65', 'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65',
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = 'size-4'): SVGSVGElement {
  const svg = document.createElementNS(SVGNS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: cls,
  }))
    svg.setAttribute(k, v);
  for (const s of ICONS[name] as Shape[]) {
    let e: SVGElement;
    if (typeof s === 'string') {
      e = document.createElementNS(SVGNS, 'path');
      e.setAttribute('d', s);
    } else if ('c' in s) {
      e = document.createElementNS(SVGNS, 'circle');
      e.setAttribute('cx', String(s.c[0]));
      e.setAttribute('cy', String(s.c[1]));
      e.setAttribute('r', String(s.c[2]));
    } else {
      e = document.createElementNS(SVGNS, 'rect');
      const [x, y, w, h, rx] = s.r;
      e.setAttribute('x', String(x));
      e.setAttribute('y', String(y));
      e.setAttribute('width', String(w));
      e.setAttribute('height', String(h));
      e.setAttribute('rx', String(rx));
    }
    svg.append(e);
  }
  return svg;
}

/** Replace each `<i data-icon="name" class="...">` with the SVG icon. The classes move to the SVG. */
export function hydrateIcons(root: ParentNode = document): void {
  for (const ph of root.querySelectorAll<HTMLElement>('i[data-icon]')) {
    const name = ph.dataset.icon as IconName;
    if (!(name in ICONS)) throw new Error(`Unknown icon ${name}`);
    ph.replaceWith(icon(name, ph.className || 'size-4'));
  }
}
