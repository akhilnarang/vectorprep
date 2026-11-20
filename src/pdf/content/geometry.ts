/** Affine matrices and axis-aligned boxes in PDF conventions. */
import type { Box } from '../../shared/types';

/** [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a then b (the PDF "a × b"): used as CTM' = M × CTM. */
export function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Extend (in place) a box with a point; creates the box when null. */
export function extend(b: Box | null, p: [number, number]): Box {
  if (!b) return [p[0], p[1], p[0], p[1]];
  if (p[0] < b[0]) b[0] = p[0];
  if (p[1] < b[1]) b[1] = p[1];
  if (p[0] > b[2]) b[2] = p[0];
  if (p[1] > b[3]) b[3] = p[1];
  return b;
}

export function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b ? [b[0], b[1], b[2], b[3]] : null;
  if (!b) return [a[0], a[1], a[2], a[3]];
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Clip intersection. `undefined` means "no clip", `null` means "empty".
 */
export function intersect(a: Box | null | undefined, b: Box | null | undefined): Box | null | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (!a || !b) return null;
  const r: Box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[0] > r[2] || r[1] > r[3] ? null : r;
}

/** Bounding box of a transformed rectangle. */
export function transformRect(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  let b: Box | null = null;
  b = extend(b, apply(m, x0, y0));
  b = extend(b, apply(m, x1, y0));
  b = extend(b, apply(m, x0, y1));
  return extend(b, apply(m, x1, y1));
}

/** Geometric-mean scale factor of a matrix (for line widths). */
export const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

export const contains = (b: Box, p: [number, number]): boolean => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
export const area = (b: Box): number => (b[2] - b[0]) * (b[3] - b[1]);
export const inside = (b: Box, r: Box): boolean => b[0] >= r[0] && b[1] >= r[1] && b[2] <= r[2] && b[3] <= r[3];
export const overlaps = (b: Box, q: Box): boolean => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1];
