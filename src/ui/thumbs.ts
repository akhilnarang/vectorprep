/** Lazy thumbnails: render only cards near the viewport, one at a time, at the device pixel ratio. */
import { el } from './dom';
import type { PDFDocumentProxy } from './pdfjs';
import { perf } from './perf';

export class Thumbnails {
  private io: IntersectionObserver | null = null;
  private queue: number[] = [];
  private running = false;
  private generation = 0;

  start(pdf: PDFDocumentProxy, indices: number[]): void {
    this.stop();
    const gen = this.generation;
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          this.io?.unobserve(e.target);
          this.queue.push(Number((e.target as HTMLElement).dataset.index));
        }
        void this.pump(pdf, gen);
      },
      { rootMargin: '300px 0px' },
    );
    for (const i of indices) {
      const box = document.getElementById(`thumb-${i}`);
      if (box) this.io.observe(box);
    }
  }

  stop(): void {
    this.generation++;
    this.io?.disconnect();
    this.io = null;
    this.queue = [];
  }

  private async pump(pdf: PDFDocumentProxy, gen: number): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.queue.length && gen === this.generation) {
      const i = this.queue.shift()!;
      try {
        await this.render(pdf, i);
      } catch (err) {
        console.warn('thumbnail failed', i + 1, err);
        document.getElementById(`thumb-${i}`)?.replaceChildren(el('div', { class: 'm-2 rounded-sm bg-background/90 px-2 py-1 text-center text-xs text-muted-foreground', text: 'No preview available' }));
      }
    }
    this.running = false;
  }

  private async render(pdf: PDFDocumentProxy, i: number): Promise<void> {
    const box = document.getElementById(`thumb-${i}`);
    if (!box) return;
    const t0 = performance.now();
    const page = await pdf.getPage(i + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const dpr = window.devicePixelRatio || 1;
    const cssBox = Math.min(box.clientWidth, box.clientHeight) || 140;
    const fit = cssBox / Math.max(vp1.width, vp1.height);
    const vp = page.getViewport({ scale: fit * dpr });
    const canvas = document.createElement('canvas');
    canvas.className = 'max-h-full max-w-full bg-white shadow-sm ring-1 ring-black/10';
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    canvas.style.width = `${Math.round(vp1.width * fit)}px`;
    canvas.style.height = `${Math.round(vp1.height * fit)}px`;
    await page.render({ canvas, viewport: vp }).promise;
    box.replaceChildren(canvas);
    perf.marks.firstThumb ??= performance.now();
    perf.marks[`thumb${i + 1}`] = Math.round(performance.now() - t0);
  }
}
