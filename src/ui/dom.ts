/** DOM and formatting helpers. */
import { type IconName, icon } from './icons';

export function $<T extends HTMLElement = HTMLElement>(sel: string): T {
  const e = document.querySelector<T>(sel);
  if (!e) throw new Error(`Missing element ${sel}`);
  return e;
}

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string> | null,
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v);
    }
  for (const k of kids) if (k) e.append(k);
  return e;
}

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
export const fmtNum = (n: number, d: number): string => (Math.round(n * 10 ** d) / 10 ** d).toString();
export const mm = (pt: number): number => (pt * 25.4) / 72;

export function fmtBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export type StatusKind = '' | 'error' | 'warn' | 'ok';

/** Colour classes for alerts and status messages. '' is the neutral "info" tone. */
export const TONE: Record<StatusKind | 'info', string> = {
  '': 'border-info/25 bg-info/8 text-info',
  info: 'border-info/25 bg-info/8 text-info',
  ok: 'border-success/30 bg-success/8 text-success',
  warn: 'border-warning/30 bg-warning/10 text-warning',
  error: 'border-destructive/30 bg-destructive/8 text-destructive',
};

const STATUS_ICON: Record<StatusKind, IconName> = { '': 'info', ok: 'check', warn: 'alert', error: 'error' };

export const spinner = (): HTMLElement =>
  el('span', { class: 'inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent', 'aria-hidden': 'true' });

/**
 * Show a message in a status element. `data-kind` holds the kind ('info', 'ok', 'warn' or 'error') for tests and styles.
 * An empty message hides the element.
 */
export function showStatus(target: string, msg: string, kind: StatusKind = '', spin = false): void {
  const s = $(target);
  s.hidden = !msg;
  s.className = `alert ${TONE[kind]}`;
  s.dataset.kind = kind || 'info';
  s.setAttribute('aria-busy', String(spin));
  s.replaceChildren();
  if (msg) {
    const lead = spin ? spinner() : icon(STATUS_ICON[kind]);
    if (spin) lead.classList.add('mt-0.5');
    s.append(lead, el('span', { class: 'min-w-0 break-words' }, msg));
  }
}

export function download(data: Uint8Array | Blob, name: string, type = 'application/pdf'): void {
  const blob = data instanceof Blob ? data : new Blob([data as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
