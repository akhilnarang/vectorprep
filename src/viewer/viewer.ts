/**
 * Artboard viewer: zoom/pan with a low-resolution base bitmap plus a sharp "detail" bitmap of
 * the visible area only, element hover/selection/marquee, and element downloads.
 *
 * View transform: screen = (pdf.js viewport point at scale 1) × s + (tx, ty).
 */
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport';
import { HUGE_MP } from '../shared/constants';
import type { Box, ElementDTO, PageReport } from '../shared/types';
import type { Backend } from '../ui/backend';
import { $, download, el, errorText, fmtBytes, fmtNum, mm, spinner } from '../ui/dom';
import { icon } from '../ui/icons';
import { PDFDocumentProxy, isCancelled, openPdfjsData } from '../ui/pdfjs';
import { perf } from '../ui/perf';
import { ElementIndex } from './tree';

export interface ViewerHost {
  backend: Backend;
  pdf(): PDFDocumentProxy | null;
  pages(): PageReport[];
  baseName(): string;
}

interface DetailFor {
  s: number;
  tx: number;
  ty: number;
}

interface ViewState {
  index: number;
  page: PDFPageProxy | null;
  vp1: PageViewport | null;
  s: number;
  tx: number;
  ty: number;
  fitS: number;
  baseScale: number;
  tree: ElementIndex | null;
  selected: Set<number>;
  hover: number | null;
  renderTask: RenderTask | null;
  detailTask: RenderTask | null;
  detailFor: DetailFor | null;
  detailIdx: 0 | 1;
  detailTimer: number;
  userUnit: number;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const MAX_BASE_PX = 4096;
const MIN_S = 0.02;
const MAX_S = 64;
const DETAIL_DEBOUNCE_MS = 140;

/** Classes of the SVG overlay rectangles. The colours stay the same in light and dark mode, because they are drawn on the artwork. */
const OVERLAY = {
  sel: 'fill-orange-500/10 stroke-orange-500 stroke-2',
  approx: '[stroke-dasharray:2_3]',
  hov: 'fill-blue-500/8 stroke-blue-500 stroke-[1.5] [stroke-dasharray:5_3]',
  marq: 'fill-blue-500/12 stroke-blue-500 stroke-1',
} as const;

export class Viewer {
  private root = $('#viewer');
  private stage = $('#stage');
  private base = $<HTMLCanvasElement>('#v-base');
  private details: [HTMLCanvasElement, HTMLCanvasElement] = [$<HTMLCanvasElement>('#v-detail-a'), $<HTMLCanvasElement>('#v-detail-b')];
  private overlay = document.querySelector('#v-overlay') as SVGSVGElement;
  private V: ViewState | null = null;
  private openSeq = 0;
  private tool: 'select' | 'hand' = 'select';
  private spaceDown = false;
  private altDown = false;
  private marqueeRect: Box | null = null;
  private dlBusy = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { kind: 'pan' | 'marquee' | 'maybe'; x: number; y: number; tx: number; ty: number; shift: boolean; alt: boolean } | null = null;
  private pinch: { d: number; s: number; mx: number; my: number; tx: number; ty: number } | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(private host: ViewerHost) {
    this.wire();
    (window as unknown as { __viewer: unknown }).__viewer = {
      state: () => {
        const V = this.V;
        return V && { index: V.index, s: V.s, tx: V.tx, ty: V.ty, fitS: V.fitS, selected: [...V.selected], scope: V.tree?.scope.id ?? null, hasTree: !!V.tree, detail: !!V.detailFor };
      },
      pdfToScreen: (x: number, y: number) => {
        const r = this.pdfRectToScreen([x, y, x, y]);
        const sr = this.stage.getBoundingClientRect();
        return [r[0] + sr.left, r[1] + sr.top];
      },
      node: (id: number) => this.V?.tree?.node(id),
      chainAt: (x: number, y: number) => this.V?.tree?.chainAt([x, y]).map((n) => n.id) ?? [],
    };
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  async open(index: number): Promise<void> {
    const pdf = this.host.pdf();
    const pages = this.host.pages();
    const p = pages[index];
    if (!pdf || !p) return;
    const seq = ++this.openSeq;
    if (this.root.hidden) {
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.setPageInert(true);
    }
    this.root.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#v-title').textContent = `Artboard ${index + 1} of ${pages.length}`;
    $<HTMLButtonElement>('#v-prev').disabled = index === 0;
    $<HTMLButtonElement>('#v-next').disabled = index === pages.length - 1;
    this.cancelRenders();
    this.V = {
      index, page: null, vp1: null, s: 1, tx: 0, ty: 0, fitS: 1, baseScale: 1, tree: null, selected: new Set(), hover: null,
      renderTask: null, detailTask: null, detailFor: null, detailIdx: 0, detailTimer: 0, userUnit: p.userUnit,
    };
    for (const c of this.details) c.classList.remove('shown');
    this.base.width = this.base.height = 1;
    this.overlay.replaceChildren();
    $('#v-hover').hidden = true;
    this.dlStatus('');
    this.setBusy('Drawing the artboard…');
    this.renderPanel();
    this.stage.focus({ preventScroll: true });

    const page = await pdf.getPage(index + 1);
    if (seq !== this.openSeq || !this.V) return;
    this.V.page = page;
    this.V.vp1 = page.getViewport({ scale: 1 });
    this.fit(false);
    const hugeNote = p.huge ? `The preview does not show images larger than ${HUGE_MP} MP. ` : '';
    this.setBusy(`${hugeNote}Drawing the artboard…`);
    const t0 = performance.now();
    const treeP = this.host.backend.elements(index); // runs in the worker while pdf.js renders
    await this.renderBase(seq);
    if (seq !== this.openSeq) return;
    this.setBusy(`${hugeNote}Finding elements…`);
    try {
      const tree = await treeP;
      if (seq !== this.openSeq || !this.V) return;
      perf.marks[`elements${index + 1}`] = Math.round(performance.now() - t0);
      this.V.tree = new ElementIndex(tree);
      this.setBusy(hugeNote);
    } catch (err) {
      console.error(err);
      this.setBusy(`Cannot find the elements: ${errorText(err)}`);
    }
    this.drawOverlay();
    this.renderPanel();
  }

  close(): void {
    this.openSeq++;
    this.cancelRenders();
    this.root.hidden = true;
    document.body.style.overflow = '';
    this.V = null;
    this.setPageInert(false);
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  /** Make the page behind the viewer inert, so Tab and screen readers stay in the dialog. */
  private setPageInert(on: boolean): void {
    for (const e of document.querySelectorAll<HTMLElement>('body > header, body > main, body > a')) e.inert = on;
  }

  private go(delta: number): void {
    if (!this.V) return;
    const i = this.V.index + delta;
    if (i >= 0 && i < this.host.pages().length) void this.open(i);
  }

  private setBusy(msg: string): void {
    const b = $('#v-busy');
    b.replaceChildren();
    if (msg.endsWith('…')) b.append(spinner());
    b.append(msg);
  }

  private cancelRenders(): void {
    const V = this.V;
    if (!V) return;
    clearTimeout(V.detailTimer);
    V.renderTask?.cancel();
    V.detailTask?.cancel();
  }

  private stageSize(): { w: number; h: number } {
    return { w: this.stage.clientWidth, h: this.stage.clientHeight };
  }

  // ------------------------------------------------------------ view transform
  private fit(apply = true): void {
    const V = this.V;
    if (!V?.vp1) return;
    const { w, h } = this.stageSize();
    const pad = 24;
    V.fitS = Math.min((w - 2 * pad) / V.vp1.width, (h - 2 * pad) / V.vp1.height);
    V.s = V.fitS;
    V.tx = (w - V.vp1.width * V.s) / 2;
    V.ty = (h - V.vp1.height * V.s) / 2;
    if (apply) this.applyView();
  }

  private zoomAt(factor: number, sx: number, sy: number): void {
    const V = this.V;
    if (!V?.vp1) return;
    const ns = Math.min(MAX_S, Math.max(MIN_S, V.s * factor));
    const k = ns / V.s;
    V.tx = sx - (sx - V.tx) * k;
    V.ty = sy - (sy - V.ty) * k;
    V.s = ns;
    this.applyView();
  }

  private zoomCenter(factor: number): void {
    const { w, h } = this.stageSize();
    this.zoomAt(factor, w / 2, h / 2);
  }

  private placeDetail(): void {
    const V = this.V;
    const d = V?.detailFor;
    if (!V || !d) return;
    const k = V.s / d.s;
    this.details[V.detailIdx].style.transform = `translate(${V.tx - d.tx * k}px, ${V.ty - d.ty * k}px) scale(${k})`;
  }

  /** Cheap update while the user zooms/pans: CSS transforms only, then a debounced sharp render. */
  private applyView(): void {
    const V = this.V;
    if (!V?.vp1) return;
    this.base.style.transform = `translate(${V.tx}px, ${V.ty}px) scale(${V.s})`;
    this.placeDetail();
    const z = $('#v-zoom');
    z.textContent = `${Math.round((V.s / V.fitS) * 100)}%`;
    this.drawOverlay();
    this.scheduleDetail();
  }

  private async renderBase(seq: number): Promise<void> {
    const V = this.V;
    if (!V?.page || !V.vp1) return;
    const dpr = window.devicePixelRatio || 1;
    V.baseScale = Math.min(MAX_BASE_PX / Math.max(V.vp1.width, V.vp1.height), V.fitS * dpr * 2);
    const vp = V.page.getViewport({ scale: V.baseScale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(vp.width));
    c.height = Math.max(1, Math.round(vp.height));
    const t0 = performance.now();
    V.renderTask = V.page.render({ canvas: c, viewport: vp });
    try {
      await V.renderTask.promise;
    } catch (e) {
      if (isCancelled(e)) return;
      throw e;
    }
    if (seq !== this.openSeq) return;
    perf.marks[`viewerBase${V.index + 1}`] = Math.round(performance.now() - t0);
    this.base.width = c.width;
    this.base.height = c.height;
    this.base.getContext('2d')?.drawImage(c, 0, 0);
    this.base.style.width = `${V.vp1.width}px`;
    this.base.style.height = `${V.vp1.height}px`;
    this.applyView();
  }

  private scheduleDetail(): void {
    const V = this.V;
    if (!V?.page) return;
    clearTimeout(V.detailTimer);
    V.detailTask?.cancel();
    V.detailTask = null;
    const dpr = window.devicePixelRatio || 1;
    if (V.s * dpr <= V.baseScale * 1.05) {
      // the base bitmap is sharp enough
      for (const c of this.details) c.classList.remove('shown');
      V.detailFor = null;
      return;
    }
    V.detailTimer = window.setTimeout(() => void this.renderDetail(), DETAIL_DEBOUNCE_MS);
  }

  /** Render only the visible stage area, so canvas size is bounded by the window, not the zoom. */
  private async renderDetail(): Promise<void> {
    const V = this.V;
    if (!V?.page) return;
    const seq = this.openSeq;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = this.stageSize();
    const want: DetailFor = { s: V.s, tx: V.tx, ty: V.ty };
    const idx: 0 | 1 = V.detailIdx === 0 ? 1 : 0;
    const c = this.details[idx];
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const vp = V.page.getViewport({ scale: want.s * dpr });
    const t0 = performance.now();
    const task = V.page.render({ canvas: c, viewport: vp, transform: [1, 0, 0, 1, want.tx * dpr, want.ty * dpr] });
    V.detailTask = task;
    try {
      await task.promise;
    } catch {
      return;
    }
    if (seq !== this.openSeq || this.V !== V || V.detailTask !== task) return;
    V.detailTask = null;
    perf.marks.lastDetail = Math.round(performance.now() - t0);
    perf.detailRenders++;
    this.details[V.detailIdx].classList.remove('shown');
    V.detailIdx = idx;
    V.detailFor = want;
    c.classList.add('shown');
    this.placeDetail();
  }

  // ------------------------------------------------------------ coordinates
  private pdfRectToScreen(b: Box): Box {
    const V = this.V!;
    const p0 = V.vp1!.convertToViewportPoint(b[0], b[1]) as number[];
    const p1 = V.vp1!.convertToViewportPoint(b[2], b[3]) as number[];
    const r = [p0[0]!, p0[1]!, p1[0]!, p1[1]!] as const;
    const x0 = Math.min(r[0], r[2]);
    const x1 = Math.max(r[0], r[2]);
    const y0 = Math.min(r[1], r[3]);
    const y1 = Math.max(r[1], r[3]);
    return [x0 * V.s + V.tx, y0 * V.s + V.ty, x1 * V.s + V.tx, y1 * V.s + V.ty];
  }

  private screenToPdf(sx: number, sy: number): [number, number] {
    const V = this.V!;
    const p = V.vp1!.convertToPdfPoint((sx - V.tx) / V.s, (sy - V.ty) / V.s);
    return [p[0], p[1]];
  }

  private localXY(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ------------------------------------------------------------ overlay
  private rectEl(b: Box, cls: string): SVGRectElement {
    const [x0, y0, x1, y1] = this.pdfRectToScreen(b);
    const r = document.createElementNS(SVGNS, 'rect');
    r.setAttribute('x', String(x0));
    r.setAttribute('y', String(y0));
    r.setAttribute('width', String(Math.max(1, x1 - x0)));
    r.setAttribute('height', String(Math.max(1, y1 - y0)));
    r.setAttribute('class', cls);
    return r;
  }

  private drawOverlay(): void {
    const V = this.V;
    if (!V?.vp1) return;
    const frag = document.createDocumentFragment();
    if (V.tree) {
      for (const id of V.selected) {
        const n = V.tree.node(id);
        if (n.b) frag.append(this.rectEl(n.b, n.a ? `${OVERLAY.sel} ${OVERLAY.approx}` : OVERLAY.sel));
      }
      if (V.hover != null && !V.selected.has(V.hover)) {
        const n = V.tree.node(V.hover);
        if (n.b) frag.append(this.rectEl(n.b, OVERLAY.hov));
      }
    }
    const m = this.marqueeRect;
    if (m) {
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('x', String(Math.min(m[0], m[2])));
      r.setAttribute('y', String(Math.min(m[1], m[3])));
      r.setAttribute('width', String(Math.abs(m[2] - m[0])));
      r.setAttribute('height', String(Math.abs(m[3] - m[1])));
      r.setAttribute('class', OVERLAY.marq);
      frag.append(r);
    }
    this.overlay.replaceChildren(frag);
  }

  private sizeLabel(b: Box): string {
    const uu = this.V!.userUnit;
    return `${fmtNum(mm((b[2] - b[0]) * uu), 1)} × ${fmtNum(mm((b[3] - b[1]) * uu), 1)} mm`;
  }

  private setHover(n: ElementDTO | null | undefined): void {
    const V = this.V;
    if (!V) return;
    const id = n ? n.id : null;
    if (id === V.hover) return;
    V.hover = id;
    const h = $('#v-hover');
    if (n && n.b) {
      h.hidden = false;
      h.textContent = `${n.n} · ${this.sizeLabel(n.b)}${n.a ? ' (approximate size)' : ''}${this.altDown ? ' · Alt: select inside the group' : ''}`;
    } else h.hidden = true;
    this.drawOverlay();
  }

  // ------------------------------------------------------------ selection panel
  private renderPanel(): void {
    const V = this.V;
    const list = $('#v-sel-list');
    list.replaceChildren();
    const tree = V?.tree ?? null;
    const has = !!tree && !!V && V.selected.size > 0;
    $('#v-sel-empty').hidden = has;
    const notes: HTMLElement[] = [];
    if (tree && V && has) {
      const nodes = [...V.selected].map((id) => tree.node(id)).sort((a, b) => a.id - b.id);
      for (const n of nodes) {
        const text = `${n.n} · ${n.b ? this.sizeLabel(n.b) : 'no size'}${n.a ? ' ≈' : ''}`;
        const rm = el('button', {
          type: 'button', title: 'Remove from selection', 'aria-label': `Remove ${n.n} from selection`,
          class: 'btn btn-ghost btn-icon size-6 rounded-sm text-muted-foreground hover:text-foreground [&_svg]:size-3.5',
        }, icon('x'));
        rm.addEventListener('click', () => {
          V.selected.delete(n.id);
          this.afterSelect();
        });
        list.append(el('li', { class: 'flex items-center justify-between gap-2 rounded-md border bg-background py-1 pr-1 pl-2.5 text-xs shadow-xs', 'data-testid': 'selection-item' },
          el('span', { class: 'min-w-0 truncate', title: text }, text), rm));
      }
      const b = tree.bounds(V.selected);
      if (b) notes.push(el('span', null, `Selection: ${this.sizeLabel(b)}${V.selected.size > 1 ? ` (${V.selected.size} elements)` : ''}`));
      if (nodes.some((n) => n.a))
        notes.push(el('span', { class: 'text-warning' }, '≈ The size is approximate for text, gradients and clipped forms. The PDF or PNG can have extra space.'));
    } else if (V && !tree) notes.push(el('span', { class: 'inline-flex items-center gap-2' }, spinner(), 'Finding elements…'));
    $('#v-sel-note').replaceChildren(...notes);
    $('#v-sel-count').textContent = has && V ? String(V.selected.size) : '';
    for (const id of ['#v-dl-pdf', '#v-dl-png']) $<HTMLButtonElement>(id).disabled = !has || this.dlBusy;
    for (const id of ['#v-parent', '#v-deeper', '#v-clear']) $<HTMLButtonElement>(id).disabled = !has;
    const img = has && tree && V ? tree.singleImage(V.selected) : null;
    const imgBtn = $<HTMLButtonElement>('#v-dl-img');
    imgBtn.disabled = !img || this.dlBusy;
    const imgLabel = img ? `Download original image ${img.n.replace(/^Image /, '')}` : 'Download original image';
    $('#v-dl-img-label').textContent = imgLabel;
    imgBtn.title = imgLabel;
    this.updatePngSize();
  }

  private updatePngSize(): void {
    const V = this.V;
    const b = V?.tree && V.selected.size ? V.tree.bounds(V.selected) : null;
    const out = $('#v-png-size');
    if (!V || !b) {
      out.textContent = '';
      return;
    }
    const dpi = Number($<HTMLSelectElement>('#v-dpi').value);
    const margin = (2 * 72) / 25.4 / V.userUnit;
    const w = Math.round((((b[2] - b[0] + 2 * margin) * V.userUnit) / 72) * dpi);
    const h = Math.round((((b[3] - b[1] + 2 * margin) * V.userUnit) / 72) * dpi);
    out.textContent = `PNG: approximately ${w.toLocaleString()} × ${h.toLocaleString()} px at real size`;
  }

  private afterSelect(): void {
    this.drawOverlay();
    this.renderPanel();
  }

  private clickSelect(pt: [number, number], shift: boolean, alt: boolean): void {
    const V = this.V;
    if (!V?.tree) return;
    const list = V.tree.chainAt(pt);
    if (alt) {
      const { from, to } = V.tree.drillTarget(list, V.selected);
      if (!to) return;
      if (!shift) V.selected.clear();
      if (from && from !== to) V.selected.delete(from.id);
      V.selected.add(to.id);
    } else {
      // shift-click toggles the deepest already-selected element under the pointer
      let target = list[0];
      for (const n of list) if (V.selected.has(n.id)) target = n;
      if (!target) {
        if (!shift) V.selected.clear();
      } else if (shift) {
        if (V.selected.has(target.id)) V.selected.delete(target.id);
        else V.selected.add(target.id);
      } else {
        V.selected.clear();
        V.selected.add(list[0]!.id);
      }
    }
    this.afterSelect();
  }

  // ------------------------------------------------------------ downloads
  private dlStatus(msg: string, kind: '' | 'busy' | 'error' = ''): void {
    const s = $('#v-dl-status');
    s.className = `flex items-start gap-2 text-xs leading-relaxed empty:hidden ${kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`;
    s.dataset.kind = kind || 'done';
    s.setAttribute('aria-busy', String(kind === 'busy'));
    s.replaceChildren();
    if (!msg) return;
    if (kind === 'busy') s.append(spinner());
    else s.append(icon(kind === 'error' ? 'error' : 'check', `mt-px size-3.5 shrink-0 ${kind === 'error' ? '' : 'text-success'}`));
    s.append(el('span', { class: 'min-w-0 break-words' }, msg));
  }

  private selBaseName(): string {
    return `${this.host.baseName()} - artboard ${this.V!.index + 1} - selection`;
  }

  private async withDl(label: string, fn: () => Promise<void>): Promise<void> {
    if (this.dlBusy || !this.V || !this.V.selected.size) return;
    this.dlBusy = true;
    this.renderPanel();
    this.dlStatus(label, 'busy');
    const t0 = performance.now();
    try {
      await fn();
      perf.marks.lastElementDl = Math.round(performance.now() - t0);
    } catch (err) {
      console.error(err);
      this.dlStatus(errorText(err), 'error');
    }
    this.dlBusy = false;
    this.renderPanel();
  }

  private dlPdf(): Promise<void> {
    return this.withDl('Making the vector PDF…', async () => {
      const V = this.V!;
      const name = this.selBaseName();
      const r = await this.host.backend.elementPdf(V.index, [...V.selected], { title: name });
      download(r.bytes, `${name}.pdf`);
      this.dlStatus(
        `Saved “${name}.pdf”. Size: ${fmtBytes(r.bytes.length)}, ${fmtNum(mm(r.sizePt[0] * r.userUnit), 1)} × ${fmtNum(mm(r.sizePt[1] * r.userUnit), 1)} mm.` +
          (r.warnings.length ? ` ${r.warnings.join(' ')}` : ''),
      );
    });
  }

  private dlPng(): Promise<void> {
    return this.withDl('Making the PNG…', async () => {
      const V = this.V!;
      const name = this.selBaseName();
      const dpi = Number($<HTMLSelectElement>('#v-dpi').value);
      // Render the extracted vector PDF, so the PNG holds the selection and nothing else.
      const r = await this.host.backend.elementPdf(V.index, [...V.selected], { title: name });
      const pdf = await openPdfjsData(r.bytes);
      try {
        const page = await pdf.getPage(1);
        const vp1 = page.getViewport({ scale: 1 });
        // pdf.js 6 applies UserUnit in its viewport; derive viewport px per PDF unit instead of assuming it.
        const pxPerUnit = Math.max(vp1.width, vp1.height) / Math.max(r.sizePt[0], r.sizePt[1]);
        let scale = ((dpi / 72) * r.userUnit) / pxPerUnit;
        const MAX_SIDE = 16384;
        const MAX_PX = 150e6;
        let note = '';
        const lim = Math.min(MAX_SIDE / Math.max(vp1.width, vp1.height), Math.sqrt(MAX_PX / (vp1.width * vp1.height)));
        if (scale > lim) {
          scale = lim;
          note = ` The browser canvas limit reduced the resolution to ${Math.floor((scale * pxPerUnit * 72) / r.userUnit)} dpi.`;
        }
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(vp.width));
        c.height = Math.max(1, Math.round(vp.height));
        // Pass our own context: it has an alpha channel, so the background stays transparent.
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('The browser has no 2D canvas.');
        await page.render({ canvas: null, canvasContext: ctx, viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
        const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
        if (!blob) throw new Error('The browser cannot make the PNG. The image is possibly too large.');
        download(blob, `${name}.png`, 'image/png');
        this.dlStatus(`Saved “${name}.png”. Size: ${c.width.toLocaleString()} × ${c.height.toLocaleString()} px, ${fmtBytes(blob.size)}. The background is transparent.${note}`);
        c.width = c.height = 0;
      } finally {
        void pdf.loadingTask.destroy();
      }
    });
  }

  private dlImg(): Promise<void> {
    const V = this.V;
    const img = V?.tree?.singleImage(V.selected);
    if (!V || !img) return Promise.resolve();
    return this.withDl('Reading the embedded image…', async () => {
      const r = await this.host.backend.imageOriginal(V.index, img.id);
      const name = `${this.host.baseName()} - artboard ${V.index + 1} - image ${r.name}.${r.ext}`;
      download(r.bytes, name, r.ext === 'png' ? 'image/png' : r.ext === 'jpg' ? 'image/jpeg' : 'image/jp2');
      this.dlStatus(`Saved “${name}”. Size: ${fmtBytes(r.bytes.length)}. ${r.note}`);
    });
  }

  // ------------------------------------------------------------ input
  private setTool(t: 'select' | 'hand'): void {
    this.tool = t;
    $('#v-tool-select').setAttribute('aria-pressed', String(t === 'select'));
    $('#v-tool-hand').setAttribute('aria-pressed', String(t === 'hand'));
    this.stage.classList.toggle('hand', t === 'hand');
    if (t === 'hand') this.setHover(null);
  }

  private onPointerDown(e: PointerEvent): void {
    const V = this.V;
    if (!V?.vp1) return;
    this.stage.setPointerCapture(e.pointerId);
    const [x, y] = this.localXY(e);
    this.pointers.set(e.pointerId, { x, y });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: V.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx: V.tx, ty: V.ty };
      this.drag = null;
      this.marqueeRect = null;
      return;
    }
    const pan = this.tool === 'hand' || this.spaceDown || e.button === 1;
    this.drag = { kind: pan ? 'pan' : 'maybe', x, y, tx: V.tx, ty: V.ty, shift: e.shiftKey, alt: e.altKey };
    if (pan) this.stage.classList.add('panning');
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    const V = this.V;
    if (!V?.vp1) return;
    const [x, y] = this.localXY(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });
    const pinch = this.pinch;
    if (pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const ns = Math.min(MAX_S, Math.max(MIN_S, pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
      const k = ns / pinch.s;
      V.s = ns;
      V.tx = (a.x + b.x) / 2 - (pinch.mx - pinch.tx) * k;
      V.ty = (a.y + b.y) / 2 - (pinch.my - pinch.ty) * k;
      this.applyView();
      return;
    }
    const d = this.drag;
    if (d) {
      if (d.kind === 'maybe' && Math.hypot(x - d.x, y - d.y) > 4) d.kind = 'marquee';
      if (d.kind === 'pan') {
        V.tx = d.tx + (x - d.x);
        V.ty = d.ty + (y - d.y);
        this.applyView();
      } else if (d.kind === 'marquee') {
        this.marqueeRect = [d.x, d.y, x, y];
        this.drawOverlay();
      }
      return;
    }
    if (V.tree && this.tool === 'select' && !this.spaceDown) {
      this.altDown = e.altKey;
      const list = V.tree.chainAt(this.screenToPdf(x, y));
      this.setHover(e.altKey ? V.tree.drillTarget(list, V.selected).to : list[0]);
    }
  }

  private onPointerEnd(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const d = this.drag;
    const V = this.V;
    if (!d || !V) return;
    this.drag = null;
    this.stage.classList.remove('panning');
    const [x, y] = this.localXY(e);
    if (d.kind === 'marquee') {
      const a = this.screenToPdf(d.x, d.y);
      const b = this.screenToPdf(x, y);
      this.marqueeRect = null;
      if (V.tree) {
        if (!d.shift) V.selected.clear();
        for (const n of V.tree.marquee([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])])) V.selected.add(n.id);
      }
      this.afterSelect();
    } else if (d.kind === 'maybe' && e.type === 'pointerup') {
      this.clickSelect(this.screenToPdf(x, y), d.shift, d.alt);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.isOpen()) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    const k = e.key;
    const V = this.V;
    if (k === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (k === 'a' && V?.tree) {
        e.preventDefault();
        V.selected = new Set(V.tree.kids(V.tree.scope).map((n) => n.id));
        this.afterSelect();
      } else if (k === '=' || k === '+') {
        e.preventDefault();
        this.zoomCenter(1.25);
      } else if (k === '-') {
        e.preventDefault();
        this.zoomCenter(0.8);
      } else if (k === '0') {
        e.preventDefault();
        this.fit();
      }
      return;
    }
    if (k === 'ArrowRight' || k === 'j' || k === 'J') {
      e.preventDefault();
      this.go(1);
    } else if (k === 'ArrowLeft' || k === 'k' || k === 'K') {
      e.preventDefault();
      this.go(-1);
    } else if (k === '+' || k === '=') this.zoomCenter(1.25);
    else if (k === '-' || k === '_') this.zoomCenter(0.8);
    else if (k === '0') this.fit();
    else if (k === 'v' || k === 'V') this.setTool('select');
    else if (k === 'h' || k === 'H') this.setTool('hand');
    else if (k === ' ') {
      e.preventDefault();
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.stage.classList.add('space');
        this.setHover(null);
      }
    } else if (k === 'Alt') this.altDown = true;
  }

  private wire(): void {
    const s = this.stage;
    s.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    s.addEventListener('pointermove', (e) => this.onPointerMove(e));
    s.addEventListener('pointerup', (e) => this.onPointerEnd(e));
    s.addEventListener('pointercancel', (e) => this.onPointerEnd(e));
    s.addEventListener('pointerleave', () => {
      if (!this.drag) this.setHover(null);
    });
    s.addEventListener(
      'wheel',
      (e) => {
        if (!this.V?.vp1) return;
        e.preventDefault();
        const [x, y] = this.localXY(e);
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        this.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), x, y);
      },
      { passive: false },
    );
    s.addEventListener('dblclick', (e) => {
      if (this.tool === 'hand') {
        const [x, y] = this.localXY(e);
        this.zoomAt(2, x, y);
      }
    });
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.spaceDown = false;
        this.stage.classList.remove('space');
      }
      if (e.key === 'Alt') this.altDown = false;
    });
    window.addEventListener('resize', () => {
      if (this.isOpen() && this.V?.vp1) this.applyView();
    });
    const on = (sel: string, fn: () => void) => $(sel).addEventListener('click', fn);
    on('#v-close', () => this.close());
    on('#v-prev', () => this.go(-1));
    on('#v-next', () => this.go(1));
    on('#v-zoom-in', () => this.zoomCenter(1.25));
    on('#v-zoom-out', () => this.zoomCenter(0.8));
    on('#v-fit', () => this.fit());
    on('#v-tool-select', () => this.setTool('select'));
    on('#v-tool-hand', () => this.setTool('hand'));
    on('#v-parent', () => {
      if (!this.V?.tree) return;
      this.V.selected = this.V.tree.parents(this.V.selected);
      this.afterSelect();
    });
    on('#v-deeper', () => {
      if (!this.V?.tree) return;
      this.V.selected = this.V.tree.children(this.V.selected);
      this.afterSelect();
    });
    on('#v-clear', () => {
      this.V?.selected.clear();
      this.afterSelect();
    });
    on('#v-dl-pdf', () => void this.dlPdf());
    on('#v-dl-png', () => void this.dlPng());
    on('#v-dl-img', () => void this.dlImg());
    $('#v-dpi').addEventListener('change', () => this.updatePngSize());
  }
}
