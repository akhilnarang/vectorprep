/** Page controller: load a file, show the report, export artboards. */
import JSZip from 'jszip';
import type { OpenError } from '../shared/types';
import { Viewer } from '../viewer/viewer';
import { Backend, createBackend, proxy } from './backend';
import { $, download, errorText, fmtBytes, showStatus } from './dom';
import { PDFDocumentProxy, openPdfjsFile } from './pdfjs';
import { perf } from './perf';
import { PageState, combinedName, fileMetaText, renderNotes, renderPageCard, singleName } from './report';
import { Thumbnails } from './thumbs';

const ERRORS: Record<OpenError, string> = {
  'no-pdf-compat': "This .ai file has no PDF compatibility. Ask the client to save it again with 'Create PDF Compatible File' selected.",
  'not-pdf': 'This file is not a PDF. It has no %PDF header.',
  encrypted: 'This PDF has a password. Ask the client for a copy without a password.',
};

interface LoadedState {
  file: File;
  baseName: string;
  pages: PageState[];
  pdf: PDFDocumentProxy | null;
  loadId: number;
}

export class App {
  private backend: Backend = createBackend();
  private state: LoadedState | null = null;
  private loadCounter = 0;
  private busy = false;
  private thumbs = new Thumbnails();
  private viewer = new Viewer({
    backend: this.backend,
    pdf: () => this.state?.pdf ?? null,
    pages: () => this.state?.pages ?? [],
    baseName: () => this.state?.baseName ?? 'document',
  });

  constructor() {
    this.wire();
  }

  async loadFile(file: File): Promise<void> {
    const myId = ++this.loadCounter;
    if (this.viewer.isOpen()) this.viewer.close();
    this.reset(false);
    const t0 = performance.now();
    showStatus('#status', `Reading ${file.name} (${fmtBytes(file.size)})…`, '', true);
    try {
      // The worker reads the File itself, so the main thread never copies the bytes.
      let done = false; // progress messages use their own channel and can arrive after the result
      const info = await this.backend.open(
        file,
        file.name,
        proxy((msg: string) => {
          if (!done && myId === this.loadCounter) showStatus('#status', `${msg} (${fmtBytes(file.size)})`, '', true);
        }),
      );
      done = true;
      if (myId !== this.loadCounter) return;
      if (info.error) {
        showStatus('#status', ERRORS[info.error], 'error');
        return;
      }
      perf.marks.report = Math.round(performance.now() - t0);
      perf.marks.workerTimings = info.timings;
      const pages: PageState[] = info.pages.map((p) => ({ ...p, selected: !p.huge }));
      this.state = { file, baseName: file.name.replace(/\.(ai|pdf)$/i, ''), pages, pdf: null, loadId: myId };
      showStatus('#status', '');
      $('#result').hidden = false;
      $('#drop').dataset.compact = '';
      $('#fname').textContent = file.name;
      $('#fmeta').textContent = fileMetaText(
        { name: file.name, size: file.size, version: info.header.version, creator: info.creator, producer: info.producer, isIllustrator: info.isIllustrator },
        pages.length,
      );
      renderNotes($('#notes'), pages, info.isIllustrator);
      const list = $('#pages');
      list.replaceChildren(...pages.map((p) => renderPageCard(p, () => this.updateSelection(), (i) => void this.viewer.open(i))));
      this.updateSelection();
      const pdf = await openPdfjsFile(file);
      if (!this.state || this.state.loadId !== myId) {
        void pdf.loadingTask.destroy();
        return;
      }
      this.state.pdf = pdf;
      this.thumbs.start(pdf, pages.filter((p) => !p.huge).map((p) => p.index));
    } catch (err) {
      console.error(err);
      if (myId === this.loadCounter) showStatus('#status', `Cannot read this file: ${errorText(err)}`, 'error');
    }
  }

  private selectedIndices(): number[] {
    return this.state ? this.state.pages.filter((p) => p.selected).map((p) => p.index) : [];
  }

  private updateSelection(): void {
    const st = this.state;
    if (!st) return;
    for (const p of st.pages) {
      if (p.checkbox) p.checkbox.checked = p.selected;
      if (p.card) p.card.dataset.selected = String(p.selected);
    }
    const sel = this.selectedIndices();
    $('#selcount').textContent = `${sel.length} of ${st.pages.length} selected`;
    for (const id of ['#exp-single', '#exp-each', '#exp-zip']) $<HTMLButtonElement>(id).disabled = sel.length === 0 || this.busy;
    $('#exp-single-name').textContent = sel.length ? combinedName(st.baseName, sel) : '';
  }

  private async runExport(kind: 'single' | 'each' | 'zip'): Promise<void> {
    const st = this.state;
    if (this.busy || !st) return;
    const sel = this.selectedIndices();
    if (!sel.length) return;
    this.busy = true;
    this.updateSelection();
    const t0 = performance.now();
    try {
      if (kind === 'single') {
        showStatus('#exp-status', 'Making the PDF…', '', true);
        const bytes = await this.backend.exportPdf(sel, st.baseName);
        const name = combinedName(st.baseName, sel);
        download(bytes, name);
        perf.marks.exportSingle = Math.round(performance.now() - t0);
        showStatus('#exp-status', `Saved “${name}”. Size: ${fmtBytes(bytes.length)}. Original file: ${fmtBytes(st.file.size)}.`, 'ok');
        return;
      }
      const zip = kind === 'zip' ? new JSZip() : null;
      let total = 0;
      for (let n = 0; n < sel.length; n++) {
        const i = sel[n]!;
        showStatus('#exp-status', `Making artboard ${i + 1} (${n + 1} of ${sel.length})…`, '', true);
        const bytes = await this.backend.exportPdf([i], st.baseName);
        total += bytes.length;
        if (zip) zip.file(singleName(st.baseName, i), bytes);
        else {
          download(bytes, singleName(st.baseName, i));
          await new Promise((r) => setTimeout(r, 400)); // let the browser start each download
        }
      }
      if (zip) {
        showStatus('#exp-status', 'Making the ZIP file…', '', true);
        const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        const name = `${st.baseName} - artboards.zip`;
        download(blob, name, 'application/zip');
        showStatus('#exp-status', `Saved “${name}”. It has ${sel.length} PDFs. Size: ${fmtBytes(blob.size)}.`, 'ok');
      } else {
        showStatus('#exp-status', `Saved ${sel.length} PDFs. Total size: ${fmtBytes(total)}. If you see only one file, let the browser download more than one file from this page.`, 'ok');
      }
    } catch (err) {
      console.error(err);
      showStatus('#exp-status', `Export failed: ${errorText(err)}`, 'error');
    } finally {
      this.busy = false;
      this.updateSelection();
    }
  }

  private reset(full: boolean): void {
    this.thumbs.stop();
    void this.state?.pdf?.loadingTask.destroy();
    this.state = null;
    $('#result').hidden = true;
    $('#pages').replaceChildren();
    $('#notes').replaceChildren();
    showStatus('#exp-status', '');
    if (full) {
      showStatus('#status', '');
      delete $('#drop').dataset.compact;
      $<HTMLInputElement>('#file').value = '';
      this.loadCounter++;
    }
  }

  private wire(): void {
    const input = $<HTMLInputElement>('#file');
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void this.loadFile(f);
    });
    $('#drop').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });

    // Drag and drop anywhere in the window.
    const overlay = $('#dropzone-overlay');
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      overlay.hidden = false;
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.hidden = true;
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      const f = e.dataTransfer?.files[0];
      if (f) void this.loadFile(f);
    });

    $('#reset').addEventListener('click', () => {
      this.reset(true);
      $('#drop').focus();
    });
    document.querySelectorAll<HTMLElement>('[data-select]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!this.state) return;
        const mode = b.dataset.select;
        for (const p of this.state.pages) p.selected = mode === 'all' ? true : mode === 'none' ? false : !p.huge;
        this.updateSelection();
      }),
    );
    $('#exp-single').addEventListener('click', () => void this.runExport('single'));
    $('#exp-each').addEventListener('click', () => void this.runExport('each'));
    $('#exp-zip').addEventListener('click', () => void this.runExport('zip'));
  }
}
