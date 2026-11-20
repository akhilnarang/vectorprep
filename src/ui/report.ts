/** Artboard report: notes and one card per page. */
import { HUGE_MP, MANY_OBJECTS, PRINT_MIN_DPI } from '../shared/constants';
import type { ArtworkCheck, PageReport, PageStatus } from '../shared/types';
import { TONE, el, fmtBytes, fmtNum, mm } from './dom';
import { type IconName, icon } from './icons';

export interface PageState extends PageReport {
  selected: boolean;
  card?: HTMLElement;
  checkbox?: HTMLInputElement;
}

const BADGE_TONE = {
  vector: 'border-success/30 bg-success/10 text-success',
  raster: 'border-info/30 bg-info/10 text-info',
  huge: 'border-destructive/30 bg-destructive/10 text-destructive',
  fonts: 'border-warning/30 bg-warning/12 text-warning',
  pixel: 'border-destructive/30 bg-destructive/10 text-destructive',
  traced: 'border-warning/30 bg-warning/12 text-warning',
  many: 'border-warning/30 bg-warning/12 text-warning',
} as const;

const BADGES: Record<PageStatus, [string, keyof typeof BADGE_TONE, IconName]> = {
  vector: ['Vector', 'vector', 'vector'],
  raster: ['Vector and raster', 'raster', 'image'],
  huge: ['Large raster: not selected', 'huge', 'alert'],
  fonts: ['Live fonts', 'fonts', 'type'],
  pixel: ['Pixel image as vectors', 'pixel', 'grid'],
  traced: ['Traced image', 'traced', 'image'],
};

/** Whole numbers with thousands separators, for example 247,535. */
const int = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Flags of the artwork checks, for `data-flags` on the card: "pixel", "traced", "many". */
export function artworkFlags(a: ArtworkCheck | null): string[] {
  if (!a) return [];
  return [a.pixel ? 'pixel' : '', a.traced ? 'traced' : '', a.many ? 'many' : ''].filter(Boolean);
}

/** Note text for an artboard that is a pixel image made of rectangles. */
export function pixelNoteText(index: number, a: ArtworkCheck): string {
  const px = a.pixel!;
  const dpi = Math.round(px.dpi);
  return (
    `Artboard ${index + 1} is a pixel image converted into ${int(px.rects)} small rectangles. ` +
    `The source image was about ${int(px.srcW)} × ${int(px.srcH)} px. ` +
    `At the real size, this is about ${int(dpi)} dpi. ` +
    (dpi < PRINT_MIN_DPI
      ? `For full-colour print, ask the client for the original image at ${PRINT_MIN_DPI} dpi or more. `
      : 'For full-colour print, ask the client for the original image. It is a better file than these rectangles. ') +
    'For vector work, redraw the artwork.'
  );
}

/** Note text for an artboard that looks like a traced image. */
export function tracedNoteText(index: number, a: ArtworkCheck): string {
  const no = ['text', 'gradients'];
  if (!a.strokes) no.unshift('strokes');
  return (
    `Artboard ${index + 1} looks like a traced image. ` +
    `It has ${int(a.fills)} filled shapes in ${int(a.colours)} flat colours. ` +
    `It has no ${no.slice(0, -1).join(', ')} or ${no[no.length - 1]}. ` +
    'Image tracing changes smooth gradients into flat bands of colour. Fine details and edges also change. ' +
    'Compare the artwork with the original image at full size. ' +
    'If the quality is not good enough, ask the client for the original image or the vector source file.'
  );
}

/** Note text for artboards with very many objects. */
export function manyNoteText(pages: PageReport[]): string {
  const parts = pages.map((p) =>
    `Artboard ${p.index + 1} has ${int(p.artwork!.drawOps)} drawing operations in ${int(p.artwork!.fills)} filled ${p.artwork!.fills === 1 ? 'path' : 'paths'}.`);
  return (
    parts.join(' ') + ' ' +
    `CorelDRAW can be very slow when a page has more than ${int(MANY_OBJECTS)} objects or path nodes. ` +
    `Export ${pages.length === 1 ? 'this artboard' : 'each of these artboards'} as a separate PDF. ` +
    'In CorelDRAW, save your work frequently.'
  );
}

function badge(label: string, tone: keyof typeof BADGE_TONE, ic: IconName): HTMLElement {
  return el('span', { class: `badge ${BADGE_TONE[tone]}`, 'data-testid': 'badge', 'data-tone': tone }, icon(ic), label);
}

function note(kind: 'bad' | 'warn' | 'info', title: string, text: string): HTMLElement {
  const [tone, ic] = ({ bad: ['error', 'error'], warn: ['warn', 'alert'], info: ['info', 'info'] } as const)[kind];
  return el('div', { class: `alert ${TONE[tone]}`, role: 'note', 'data-testid': 'note', 'data-kind': kind }, icon(ic),
    el('div', { class: 'flex min-w-0 flex-col gap-0.5' },
      el('p', { class: 'font-semibold' }, title),
      el('p', { class: 'text-foreground/85' }, text)));
}

export interface FileMeta {
  name: string;
  size: number;
  version: string;
  creator: string | null;
  producer: string | null;
  isIllustrator: boolean;
}

export function fileMetaText(m: FileMeta, pages: number): string {
  return [
    fmtBytes(m.size),
    `PDF ${m.version || '?'}`,
    `${pages} ${pages === 1 ? 'page' : 'pages'}`,
    m.creator ? `Creator: ${m.creator}` : null,
    m.producer && m.producer !== m.creator ? `Producer: ${m.producer}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function renderNotes(target: HTMLElement, pages: PageReport[], isIllustrator: boolean): void {
  target.replaceChildren();
  const huge = pages.filter((p) => p.huge);
  const fonts = pages.filter((p) => p.fonts.length);
  const uu = pages.filter((p) => p.userUnit !== 1);
  const list = (ps: PageReport[]) => ps.map((p) => p.index + 1).join(', ');
  if (huge.length)
    target.append(
      note('bad', 'Large raster images',
        `${huge.length === 1 ? 'Artboard' : 'Artboards'} ${list(huge)} ${huge.length === 1 ? 'has' : 'have'} raster images larger than ${HUGE_MP} MP. ` +
          `This is usually an overview or presentation board. CorelDRAW can be very slow or fail with ${huge.length === 1 ? 'this artboard' : 'these artboards'}. ` +
          `The tool does not select ${huge.length === 1 ? 'it' : 'them'}.`),
    );
  for (const p of pages) {
    const a = p.artwork;
    if (a?.pixel) target.append(note('bad', 'Pixel image as vectors', pixelNoteText(p.index, a)));
    else if (a?.traced) target.append(note('warn', 'Traced image', tracedNoteText(p.index, a)));
  }
  const many = pages.filter((p) => p.artwork?.many);
  if (many.length) target.append(note('warn', 'Very many objects', manyNoteText(many)));
  if (fonts.length)
    target.append(
      note('warn', 'Live fonts',
        `${fonts.length === 1 ? 'Artboard' : 'Artboards'} ${list(fonts)} ${fonts.length === 1 ? 'has' : 'have'} text that is not converted to outlines. ` +
          'CorelDRAW replaces each font that is not installed on this computer. ' +
          'Ask the client for a version with outlines, or convert the text in Illustrator or Inkscape. ' +
          'This version cannot convert text to outlines. A conversion with Ghostscript is planned.'),
    );
  if (uu.length) {
    const units = [...new Set(uu.map((p) => p.userUnit))].join(', ');
    target.append(
      note('info', 'Large canvas',
        `${uu.length === pages.length ? 'All artboards use' : 'Some artboards use'} a PDF UserUnit of ${units}. ` +
          'The real size is the nominal point size multiplied by the UserUnit. Each card shows the two sizes. ' +
          'The exported PDFs keep the UserUnit.'),
    );
  }
  if (isIllustrator)
    target.append(
      note('info', 'Illustrator file',
        'The file is PDF compatible. The export removes the Illustrator private editing data. ' +
          'You cannot edit the exported PDF as a native .ai file. All artwork stays in the file.'),
    );
}

export function renderPageCard(p: PageState, onToggle: (p: PageState) => void, onOpen: (index: number) => void): HTMLElement {
  const label = `Artboard ${p.index + 1}`;
  const cb = el('input', {
    type: 'checkbox', id: `include-${p.index}`, 'aria-label': `Select artboard ${p.index + 1}`, 'data-testid': 'include',
    class: 'mt-1 size-4 shrink-0 cursor-pointer rounded-sm accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
  });
  cb.checked = p.selected;
  cb.addEventListener('change', () => {
    p.selected = cb.checked;
    onToggle(p);
  });

  const ph = el('div', {
    class: 'm-2 rounded-sm bg-background/90 px-2 py-1 text-center text-xs whitespace-pre-line text-muted-foreground',
    'data-placeholder': '',
    text: p.huge ? `No preview\n(large raster images, ${fmtNum(p.totalMP, 0)} MP)` : 'Loading preview…',
  });
  const thumb = el('div', {
    class: 'bg-checker relative flex size-36 shrink-0 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border outline-none transition-shadow ' +
      'hover:ring-2 hover:ring-ring/40 focus-visible:ring-[3px] focus-visible:ring-ring/60 max-sm:w-full',
    id: `thumb-${p.index}`, tabindex: '0', role: 'button', 'data-testid': 'thumb',
    'aria-label': `Open artboard ${p.index + 1} in the viewer`, 'data-index': String(p.index),
  }, ph);
  thumb.addEventListener('click', () => onOpen(p.index));
  thumb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(p.index);
    }
  });

  const [bLabel, bTone, bIcon] = BADGES[p.status];
  const head = el('div', { class: 'flex flex-wrap items-center gap-2' },
    el('label', { class: 'cursor-pointer text-[15px] font-semibold', for: `include-${p.index}`, text: label }),
    badge(bLabel, bTone, bIcon),
    p.status === 'huge' && p.fonts.length ? badge('Live fonts', 'fonts', 'type') : null,
    (p.status === 'fonts' || p.status === 'pixel' || p.status === 'traced') && p.images.length ? badge('Raster images', 'raster', 'image') : null,
    p.artwork?.pixel && p.status !== 'pixel' ? badge(BADGES.pixel[0], 'pixel', 'grid') : null,
    p.artwork?.traced && p.status !== 'traced' ? badge(BADGES.traced[0], 'traced', 'image') : null,
    p.artwork?.many ? badge('Many objects', 'many', 'layers') : null);

  let dims = `${fmtNum(mm(p.wPt * p.userUnit), 1)} × ${fmtNum(mm(p.hPt * p.userUnit), 1)} mm  ·  ` +
    `${fmtNum(p.wPt * p.userUnit, 2)} × ${fmtNum(p.hPt * p.userUnit, 2)} pt`;
  if (p.userUnit !== 1) dims += `  (nominal ${fmtNum(p.wPt, 2)} × ${fmtNum(p.hPt, 2)} pt × UserUnit ${p.userUnit})`;
  if (p.rotation) dims += `  · rotated ${p.rotation}°`;

  const section = (title: string, ic: IconName, items: HTMLElement | null, empty: string): HTMLElement =>
    el('div', { class: 'flex flex-col gap-1' },
      el('div', { class: 'flex items-center gap-1.5 font-medium' }, icon(ic, 'size-3.5 text-muted-foreground'), title),
      items ?? el('div', { class: 'pl-5 text-muted-foreground', text: empty }));
  const list = (rows: [string, boolean][]): HTMLElement =>
    el('ul', { class: 'flex flex-col gap-0.5 pl-5 text-xs text-muted-foreground tabular-nums' },
      ...rows.map(([t, big]) => el('li', { class: big ? 'font-semibold text-destructive' : '' }, t)));

  const imgRows: [string, boolean][] = [...p.images].sort((a, b) => b.mp - a.mp).map((im) => [
    `${im.w.toLocaleString()} × ${im.h.toLocaleString()} px · ${fmtNum(im.mp, 1)} MP · ${im.cs}` +
      (im.bpc ? ` ${im.bpc}-bit` : '') + (im.alpha ? ' + alpha' : '') + ` · ${im.filter}` + (im.uses > 1 ? ` · used ${im.uses}×` : ''),
    im.mp > HUGE_MP,
  ]);
  const detail = el('div', { class: 'grid gap-3 text-[13px] lg:grid-cols-2', 'data-testid': 'card-detail' },
    section(
      p.images.length ? `Raster images: ${p.images.length} (${fmtNum(p.totalMP, 1)} MP in total)` : 'Raster images', 'image',
      p.images.length ? list(imgRows) : null, 'No raster images.'),
    section(
      p.fonts.length ? `Live fonts: ${p.fonts.length}` : 'Fonts', 'type',
      p.fonts.length ? list(p.fonts.map((f) => [`${f.name} · ${f.subtype} · ${f.embedded ? 'embedded' : 'not embedded'}`, !f.embedded])) : null,
      'No live fonts. All text is outlines, or there is no text.'),
    artworkSection(p.artwork));

  const card = el('div', {
    class: 'group/card flex gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs transition-opacity max-sm:flex-wrap ' +
      'data-[selected=false]:opacity-60 data-[selected=false]:hover:opacity-90',
    id: `page-${p.index}`, role: 'listitem', 'data-testid': 'artboard-card', 'data-status': p.status, 'data-selected': String(p.selected),
    'data-flags': artworkFlags(p.artwork).join(' '),
  },
    cb, thumb,
    el('div', { class: 'flex min-w-0 flex-1 flex-col gap-2' }, head,
      el('div', { class: 'text-[13px] text-muted-foreground tabular-nums', 'data-testid': 'card-dims', text: dims }), detail,
      p.fonts.length
        ? el('div', { class: 'flex items-center gap-1.5 text-[13px] font-medium text-warning' }, icon('alert', 'size-3.5'), 'Convert the text to outlines before you open the file in CorelDRAW.')
        : null));
  p.card = card;
  p.checkbox = cb;
  return card;
}

/** The "Artwork" lines of a card: object counts, and the pixel grid if there is one. */
function artworkSection(a: ArtworkCheck | null): HTMLElement | null {
  if (!a) return null;
  const rows = [
    `${int(a.drawOps)} drawing operations · ${int(a.fills)} filled paths · ${int(a.colours)} fill colours` +
      (a.strokes ? ` · ${int(a.strokes)} strokes` : ''),
  ];
  if (a.pixel)
    rows.push(`${int(a.pixel.rects)} rectangles of ${a.pixel.unitPt} pt · source about ${int(a.pixel.srcW)} × ${int(a.pixel.srcH)} px · ${int(a.pixel.dpi)} dpi`);
  if (a.partial) rows.push('The tool checked only part of the content (size limit).');
  const flagged = !!(a.pixel || a.traced || a.many);
  return el('div', { class: 'flex flex-col gap-1 lg:col-span-2', 'data-testid': 'card-artwork' },
    el('div', { class: 'flex items-center gap-1.5 font-medium' }, icon('layers', 'size-3.5 text-muted-foreground'), 'Artwork'),
    el('ul', { class: 'flex flex-col gap-0.5 pl-5 text-xs text-muted-foreground tabular-nums' },
      ...rows.map((t, i) => el('li', { class: flagged && i > 0 ? 'font-semibold text-destructive' : '' }, t))));
}

/** "1-3, 5" */
export function rangeLabel(nums: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j]! + 1) j++;
    parts.push(i === j ? `${nums[i]}` : `${nums[i]}-${nums[j]}`);
    i = j;
  }
  return parts.join(', ');
}

export function combinedName(base: string, indices: number[]): string {
  const nums = indices.map((i) => i + 1);
  return `${base} (${nums.length === 1 ? 'artboard' : 'artboards'} ${rangeLabel(nums)}).pdf`;
}

export const singleName = (base: string, i: number): string => `${base} - artboard ${i + 1}.pdf`;
