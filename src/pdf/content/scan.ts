/**
 * Counting pass over a content stream, for the artwork checks in `src/pdf/artwork.ts`.
 *
 * The scanner reads the decoded bytes directly. It does not make tokens, strings or element
 * nodes, so a 4 MB stream with 250,000 operators takes tens of milliseconds. It keeps only
 * the state that the checks need: the CTM, the fill colour, the current path and a size
 * histogram of the axis-aligned rectangles that are filled.
 */
import type { Box } from '../../shared/types';
import { IDENTITY, Matrix, mul } from './geometry';

export interface ScanGState {
  ctm: Matrix;
  /** key of the current fill colour (colour space and components) */
  fill: string;
}

export interface ScanStats {
  /** all operators */
  ops: number;
  /** path construction and painting operators */
  drawOps: number;
  /** painted paths that fill (f, F, f*, B, B*, b, b*) */
  fills: number;
  /** painted paths that stroke (S, s, B, B*, b, b*) */
  strokes: number;
  /** filled paths that have one or more Bézier segments */
  curvedFills: number;
  /** subpaths in filled paths */
  fillSubpaths: number;
  /** axis-aligned rectangles in filled paths (`re`, or m + 3 or 4 l) */
  rects: number;
  /** rectangle widths and heights in page space, in 1/100 pt, with their counts */
  wHist: Map<number, number>;
  hHist: Map<number, number>;
  /** page-space box of the filled rectangles */
  rectBox: Box | null;
  /** distinct fill colours that were used by a fill */
  colours: Set<string>;
  text: number;
  shadings: number;
  /** fills with a pattern colour (tiling patterns and gradients) */
  patterns: number;
  images: number;
  forms: number;
  /** decoded bytes that were read */
  bytes: number;
  /** true if a limit stopped the scan before the end */
  partial: boolean;
}

export const newScanStats = (): ScanStats => ({
  ops: 0, drawOps: 0, fills: 0, strokes: 0, curvedFills: 0, fillSubpaths: 0, rects: 0,
  wHist: new Map(), hHist: new Map(), rectBox: null, colours: new Set(),
  text: 0, shadings: 0, patterns: 0, images: 0, forms: 0, bytes: 0, partial: false,
});

/** Called for each `Do`. The caller looks up the XObject and can scan a form with `gs`. */
export type XObjectHook = (name: string, gs: ScanGState) => void;

const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DL = new Uint8Array(256);
for (const c of '()<>[]{}/%') DL[c.charCodeAt(0)] = 1;

/** Operator code: up to three bytes packed in one integer. */
const code = (s: string): number => s.charCodeAt(0) | ((s.charCodeAt(1) || 0) << 8) | ((s.charCodeAt(2) || 0) << 16);
const OP = {
  m: code('m'), l: code('l'), c: code('c'), v: code('v'), y: code('y'), h: code('h'), re: code('re'),
  f: code('f'), F: code('F'), fs: code('f*'), B: code('B'), Bs: code('B*'), b: code('b'), bs: code('b*'),
  S: code('S'), s: code('s'), n: code('n'),
  q: code('q'), Q: code('Q'), cm: code('cm'),
  g: code('g'), rg: code('rg'), k: code('k'), cs: code('cs'), sc: code('sc'), scn: code('scn'),
  sh: code('sh'), BT: code('BT'), Do: code('Do'), BI: code('BI'),
};

function latin1(s: Uint8Array, a: number, b: number): string {
  let r = '';
  for (let i = a; i < b; i++) r += String.fromCharCode(s[i]!);
  return r;
}

/** Skip a literal string that starts at `i` ('('). Returns the index after it. */
function skipString(s: Uint8Array, i: number): number {
  const len = s.length;
  let depth = 0;
  while (i < len) {
    const d = s[i]!;
    if (d === 92) {
      i += 2;
      continue;
    }
    if (d === 40) depth++;
    else if (d === 41 && --depth === 0) return i + 1;
    i++;
  }
  return len;
}

/** Skip an array or dictionary that starts at `i` ('[' or '<<'). Strings inside are skipped as a whole. */
function skipNested(s: Uint8Array, i: number): number {
  const len = s.length;
  let depth = 0;
  while (i < len) {
    const d = s[i]!;
    if (d === 40) {
      i = skipString(s, i);
      continue;
    }
    if (d === 91) depth++;
    else if (d === 93) depth--;
    else if (d === 60) {
      if (s[i + 1] === 60) {
        depth++;
        i++;
      } else {
        while (i < len && s[i] !== 62) i++; // hex string
      }
    } else if (d === 62 && s[i + 1] === 62) {
      depth--;
      i++;
    }
    i++;
    if (depth <= 0) return i;
  }
  return len;
}

/** Skip inline image data: from after `BI` to after `EI`. */
function skipInlineImage(s: Uint8Array, i: number): number {
  const len = s.length;
  const ws = (k: number) => k >= len || WS[s[k]!] === 1;
  let j = i;
  while (j + 1 < len && !(s[j] === 73 && s[j + 1] === 68 && ws(j - 1) && ws(j + 2))) j++; // ID
  for (let k = j + 3; k + 1 < len; k++) if (s[k] === 69 && s[k + 1] === 73 && ws(k - 1) && ws(k + 2)) return k + 2; // EI
  return len;
}

/** Rectangles are buffered while a path is built. A fill adds them to the histogram; other paints drop them. */
class RectBuffer {
  data = new Float64Array(6 * 1024);
  n = 0;
  push(x0: number, y0: number, x1: number, y1: number): void {
    if (this.n * 6 + 6 > this.data.length) {
      const d = new Float64Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    const o = this.n * 6;
    const d = this.data;
    d[o] = Math.min(x0, x1);
    d[o + 1] = Math.min(y0, y1);
    d[o + 2] = Math.max(x0, x1);
    d[o + 3] = Math.max(y0, y1);
    this.n++;
  }
  commit(st: ScanStats): void {
    const d = this.data;
    let b = st.rectBox;
    for (let r = 0; r < this.n; r++) {
      const o = r * 6;
      const x0 = d[o]!, y0 = d[o + 1]!, x1 = d[o + 2]!, y1 = d[o + 3]!;
      const w = Math.round((x1 - x0) * 100);
      const h = Math.round((y1 - y0) * 100);
      if (w <= 0 || h <= 0) continue;
      st.rects++;
      st.wHist.set(w, (st.wHist.get(w) ?? 0) + 1);
      st.hHist.set(h, (st.hHist.get(h) ?? 0) + 1);
      if (!b) b = [x0, y0, x1, y1];
      else {
        if (x0 < b[0]) b[0] = x0;
        if (y0 < b[1]) b[1] = y0;
        if (x1 > b[2]) b[2] = x1;
        if (y1 > b[3]) b[3] = y1;
      }
    }
    st.rectBox = b;
    this.n = 0;
  }
}

/**
 * Scan one content stream and add its counts to `st`.
 * `maxBytes` limits the total of `st.bytes`. The scan stops and sets `st.partial` at the limit.
 */
export function scanContent(
  s: Uint8Array,
  st: ScanStats,
  gsIn: ScanGState = { ctm: IDENTITY, fill: 'g0' },
  onXObject?: XObjectHook,
  maxBytes = Infinity,
): void {
  let len = s.length;
  if (st.bytes + len > maxBytes) {
    len = Math.max(0, maxBytes - st.bytes);
    st.partial = true;
  }
  st.bytes += len;
  const nums = new Float64Array(34);
  let nn = 0;
  let nameA = -1;
  let nameB = -1;
  let gs: ScanGState = { ctm: gsIn.ctm, fill: gsIn.fill };
  let fillCs = 'g';
  const stack: { gs: ScanGState; cs: string }[] = [];
  const rects = new RectBuffer();

  // Current path.
  let pathSub = 0;
  let pathCurve = false;
  // Current subpath, for rectangles drawn with m and l.
  let spN = 0; // points
  let spAxis = true;
  let spX0 = 0, spY0 = 0, cx = 0, cy = 0;
  let spMinX = 0, spMinY = 0, spMaxX = 0, spMaxY = 0;

  const addRect = (x0: number, y0: number, x1: number, y1: number) => {
    const m = gs.ctm;
    if (m[1] === 0 && m[2] === 0)
      rects.push(m[0] * x0 + m[4], m[3] * y0 + m[5], m[0] * x1 + m[4], m[3] * y1 + m[5]);
    else if (m[0] === 0 && m[3] === 0)
      rects.push(m[2] * y0 + m[4], m[1] * x0 + m[5], m[2] * y1 + m[4], m[1] * x1 + m[5]);
  };
  const endSubpath = () => {
    // m + 3 l, or m + 4 l back to the start. The closing edge must also be horizontal or vertical.
    if (spAxis && (spN === 4 || (spN === 5 && cx === spX0 && cy === spY0)) && (cx === spX0 || cy === spY0))
      addRect(spMinX, spMinY, spMaxX, spMaxY);
    spN = 0;
  };
  const point = (x: number, y: number) => {
    if (spN === 0) {
      spX0 = spMinX = spMaxX = x;
      spY0 = spMinY = spMaxY = y;
    } else {
      if (x !== cx && y !== cy) spAxis = false;
      if (x < spMinX) spMinX = x;
      if (x > spMaxX) spMaxX = x;
      if (y < spMinY) spMinY = y;
      if (y > spMaxY) spMaxY = y;
    }
    cx = x;
    cy = y;
    spN++;
  };
  const resetPath = () => {
    pathSub = 0;
    pathCurve = false;
    spN = 0;
    rects.n = 0;
  };
  const colourKey = (prefix: string) => {
    let k = prefix;
    for (let j = 0; j < nn; j++) k += ' ' + nums[j];
    return k;
  };

  let i = 0;
  while (i < len) {
    const c = s[i]!;
    if (WS[c]) {
      i++;
      continue;
    }
    if (c === 37) {
      while (i < len && s[i] !== 10 && s[i] !== 13) i++;
      continue;
    }
    if (c === 47) {
      nameA = ++i;
      while (i < len && !WS[s[i]!] && !DL[s[i]!]) i++;
      nameB = i;
      continue;
    }
    if (c === 40) {
      i = skipString(s, i);
      continue;
    }
    if (c === 91 || (c === 60 && s[i + 1] === 60)) {
      i = skipNested(s, i);
      continue;
    }
    if (c === 60) {
      while (i < len && s[i] !== 62) i++;
      i++;
      continue;
    }
    if (c === 41 || c === 62 || c === 93 || c === 123 || c === 125) {
      i++;
      continue;
    }
    if ((c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46) {
      // number
      let neg = false;
      if (c === 45 || c === 43) {
        neg = c === 45;
        i++;
      }
      let v = 0;
      let div = 1;
      let dot = false;
      while (i < len) {
        const d = s[i]!;
        if (d >= 48 && d <= 57) {
          v = v * 10 + (d - 48);
          if (dot) div *= 10;
        } else if (d === 46 && !dot) dot = true;
        else if (d === 45 && v === 0 && !dot) neg = !neg; // "--1" in some writers
        else break;
        i++;
      }
      if (nn < nums.length) nums[nn++] = neg ? -v / div : v / div;
      continue;
    }

    // operator
    const a = i;
    while (i < len && !WS[s[i]!] && !DL[s[i]!]) i++;
    const wl = i - a;
    const op = wl <= 3 ? s[a]! | ((wl > 1 ? s[a + 1]! : 0) << 8) | ((wl > 2 ? s[a + 2]! : 0) << 16) : -1;
    st.ops++;
    const hasName = nameA >= 0;

    switch (op) {
      case OP.m:
        st.drawOps++;
        endSubpath();
        pathSub++;
        spAxis = true;
        point(nums[0]!, nums[1]!);
        break;
      case OP.l:
        st.drawOps++;
        if (spN === 0) {
          pathSub++;
          spAxis = true;
        }
        point(nums[0]!, nums[1]!);
        break;
      case OP.c:
      case OP.v:
      case OP.y: {
        st.drawOps++;
        pathCurve = true;
        spAxis = false;
        const k = op === OP.c ? 4 : 2;
        cx = nums[k]!;
        cy = nums[k + 1]!;
        spN++;
        break;
      }
      case OP.h:
        st.drawOps++;
        break;
      case OP.re: {
        st.drawOps++;
        endSubpath();
        pathSub++;
        const x = nums[0]!, y = nums[1]!;
        addRect(x, y, x + nums[2]!, y + nums[3]!);
        spN = 0;
        cx = x;
        cy = y;
        break;
      }
      case OP.f:
      case OP.F:
      case OP.fs:
      case OP.B:
      case OP.Bs:
      case OP.b:
      case OP.bs:
        st.drawOps++;
        endSubpath();
        st.fills++;
        st.fillSubpaths += pathSub;
        if (pathCurve) st.curvedFills++;
        if (op === OP.B || op === OP.Bs || op === OP.b || op === OP.bs) st.strokes++;
        if (gs.fill.charCodeAt(0) === 35 /* # */) st.patterns++;
        st.colours.add(gs.fill);
        rects.commit(st);
        resetPath();
        break;
      case OP.S:
      case OP.s:
        st.drawOps++;
        st.strokes++;
        resetPath();
        break;
      case OP.n:
        st.drawOps++;
        resetPath();
        break;
      case OP.q:
        stack.push({ gs, cs: fillCs });
        gs = { ctm: gs.ctm, fill: gs.fill };
        break;
      case OP.Q: {
        const p = stack.pop();
        if (p) {
          gs = p.gs;
          fillCs = p.cs;
        }
        break;
      }
      case OP.cm:
        if (nn >= 6) gs.ctm = mul([nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!], gs.ctm);
        break;
      case OP.g:
      case OP.rg:
      case OP.k:
        fillCs = op === OP.g ? 'g' : op === OP.rg ? 'rg' : 'k';
        gs.fill = colourKey(fillCs);
        break;
      case OP.cs:
        fillCs = hasName ? latin1(s, nameA, nameB) : '?';
        gs.fill = fillCs;
        break;
      case OP.sc:
      case OP.scn:
        gs.fill = hasName ? '#' + latin1(s, nameA, nameB) : colourKey(fillCs);
        break;
      case OP.sh:
        st.shadings++;
        break;
      case OP.BT:
        st.text++;
        break;
      case OP.BI:
        st.images++;
        i = skipInlineImage(s, i);
        break;
      case OP.Do:
        if (hasName && onXObject) onXObject(latin1(s, nameA, nameB), { ctm: gs.ctm, fill: gs.fill });
        break;
      default:
        break;
    }
    nn = 0;
    nameA = nameB = -1;
  }
  if (len < s.length) st.partial = true;
}
