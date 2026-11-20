/** Content-stream tokenizer. Keeps the raw text of every operand so operations can be re-emitted verbatim. */

export type TokenType = 'name' | 'str' | 'hex' | 'num' | 'kw' | 'arr' | 'dict';

export interface Token {
  t: TokenType;
  /** exact source text */
  raw: string;
  /** decoded name (for 'name') or number value (for 'num') */
  v?: string | number;
}

export interface Op {
  op: string;
  args: Token[];
  /** for inline images (op === 'BI'): the whole BI ... EI text */
  raw?: string;
  w?: number;
  h?: number;
}

const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DL = new Uint8Array(256);
for (const c of '()<>[]{}/%') DL[c.charCodeAt(0)] = 1;

/** Bytes to a string with one char per byte (round-trips through latin1ToBytes). */
export function bytesToLatin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

export function latin1ToBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

export function decodeName(raw: string): string {
  return raw.slice(1).replace(/#([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export const numArg = (t: Token | undefined, dflt = 0): number => (t && typeof t.v === 'number' ? t.v : dflt);
export const nameArg = (t: Token | undefined): string => (t && t.t === 'name' && typeof t.v === 'string' ? t.v : '');

interface Nest {
  start: number;
  saved: Token[];
}

/** Tokenize a content stream (as a latin1 string) into operations. */
export function tokenize(s: string): Op[] {
  const ops: Op[] = [];
  const len = s.length;
  let i = 0;
  let operands: Token[] = [];
  const nest: Nest[] = [];
  const isWs = (k: number) => k < len && WS[s.charCodeAt(k)] === 1;

  while (i < len) {
    const c = s.charCodeAt(i);
    if (WS[c]) {
      i++;
      continue;
    }
    if (c === 37) {
      // % comment
      while (i < len && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) i++;
      continue;
    }
    const start = i;
    if (c === 47) {
      // /Name
      i++;
      while (i < len) {
        const d = s.charCodeAt(i);
        if (WS[d] || DL[d]) break;
        i++;
      }
      const raw = s.slice(start, i);
      operands.push({ t: 'name', raw, v: decodeName(raw) });
      continue;
    }
    if (c === 40) {
      // (literal string) with nesting and escapes
      let depth = 0;
      while (i < len) {
        const d = s.charCodeAt(i);
        if (d === 92) {
          i += 2;
          continue;
        }
        if (d === 40) depth++;
        else if (d === 41) {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      operands.push({ t: 'str', raw: s.slice(start, i) });
      continue;
    }
    if (c === 60) {
      if (s.charCodeAt(i + 1) === 60) {
        nest.push({ start, saved: operands });
        operands = [];
        i += 2;
        continue;
      }
      const j = s.indexOf('>', i);
      i = j < 0 ? len : j + 1;
      operands.push({ t: 'hex', raw: s.slice(start, i) });
      continue;
    }
    if (c === 62) {
      i += s.charCodeAt(i + 1) === 62 ? 2 : 1;
      const n = nest.pop();
      if (n) {
        operands = n.saved;
        operands.push({ t: 'dict', raw: s.slice(n.start, i) });
      }
      continue;
    }
    if (c === 91) {
      nest.push({ start, saved: operands });
      operands = [];
      i++;
      continue;
    }
    if (c === 93) {
      i++;
      const n = nest.pop();
      if (n) {
        operands = n.saved;
        operands.push({ t: 'arr', raw: s.slice(n.start, i) });
      }
      continue;
    }
    if (c === 123 || c === 125 || c === 41) {
      i++;
      continue;
    }
    while (i < len) {
      const d = s.charCodeAt(i);
      if (WS[d] || DL[d]) break;
      i++;
    }
    const word = s.slice(start, i);
    if (/^[+\-.\d]/.test(word)) {
      operands.push({ t: 'num', raw: word, v: parseFloat(word) || 0 });
      continue;
    }
    if (word === 'true' || word === 'false' || word === 'null' || nest.length) {
      operands.push({ t: 'kw', raw: word });
      continue;
    }
    if (word === 'BI') {
      // Inline image: BI <key value ...> ID <binary data> EI
      let j = s.indexOf('ID', i);
      while (j >= 0 && !(isWs(j - 1) && (j + 2 >= len || isWs(j + 2)))) j = s.indexOf('ID', j + 2);
      if (j < 0) break;
      let k = j + 3;
      let e = -1;
      while (k < len) {
        k = s.indexOf('EI', k);
        if (k < 0) break;
        if (isWs(k - 1) && (k + 2 >= len || isWs(k + 2))) {
          e = k + 2;
          break;
        }
        k += 2;
      }
      if (e < 0) e = len;
      const hdr = s.slice(i, j);
      const w = /\/(?:W|Width)\s+(\d+)/.exec(hdr);
      const h = /\/(?:H|Height)\s+(\d+)/.exec(hdr);
      ops.push({ op: 'BI', args: [], raw: s.slice(start, e), w: w ? +w[1]! : 0, h: h ? +h[1]! : 0 });
      i = e;
      operands = [];
      continue;
    }
    ops.push({ op: word, args: operands });
    operands = [];
  }
  return ops;
}
