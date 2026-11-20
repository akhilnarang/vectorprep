/** Small typed helpers around pdf-lib objects. */
import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';

export const N = (s: string): PDFName => PDFName.of(s);

export function deref(ctx: PDFContext, o: PDFObject | undefined): PDFObject | undefined {
  return o instanceof PDFRef ? ctx.lookup(o) : o;
}

/** The dictionary of a dict or stream object, else null. */
export function dictOf(o: PDFObject | undefined): PDFDict | null {
  if (o instanceof PDFDict) return o;
  if (o instanceof PDFRawStream) return o.dict;
  const maybe = o as { dict?: unknown } | undefined;
  return maybe && maybe.dict instanceof PDFDict ? maybe.dict : null;
}

export function nameOf(o: PDFObject | undefined): string | null {
  if (!(o instanceof PDFName)) return null;
  try {
    return o.decodeText();
  } catch {
    return o.asString().replace(/^\//, '');
  }
}

export function numOf(o: PDFObject | undefined): number | null {
  return o instanceof PDFNumber ? o.asNumber() : null;
}

export function numsOf(ctx: PDFContext, o: PDFObject | undefined): number[] | null {
  const arr = deref(ctx, o);
  if (!(arr instanceof PDFArray)) return null;
  return arr.asArray().map((x) => numOf(deref(ctx, x)) ?? 0);
}

export function bytesOfString(o: PDFObject | undefined): Uint8Array | null {
  if (o instanceof PDFHexString || o instanceof PDFString) return o.asBytes();
  return null;
}

/** Look up an inheritable page attribute by walking /Parent links. */
export function inherited(node: PDFDict, key: string): PDFObject | undefined {
  let n: PDFDict | undefined = node;
  for (let guard = 0; n && guard < 64; guard++) {
    const v = n.get(N(key));
    if (v !== undefined) return v;
    const p: PDFObject | undefined = n.lookup(N('Parent'));
    n = p instanceof PDFDict ? p : undefined;
  }
  return undefined;
}

/** Resolve resources[cat][name] (raw value, may be a reference). */
export function lookupRes(ctx: PDFContext, res: PDFDict | null, cat: string, name: string): PDFObject | undefined {
  const d = res ? dictOf(deref(ctx, res.get(N(cat)))) : null;
  return d ? d.get(N(name)) : undefined;
}

export function isTrue(o: PDFObject | undefined): boolean {
  return !!o && o.toString() === 'true';
}
