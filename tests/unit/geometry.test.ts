import { describe, expect, it } from 'vitest';
import { IDENTITY, apply, intersect, mul, scaleOf, transformRect, union } from '../../src/pdf/content/geometry';

describe('matrices', () => {
  it('composes as PDF does (CTM\' = M × CTM)', () => {
    const translate = [1, 0, 0, 1, 10, 20] as const;
    const scale = [2, 0, 0, 3, 0, 0] as const;
    // scale first, then translate
    expect(apply(mul([...scale], [...translate]), 1, 1)).toEqual([12, 23]);
    // translate first, then scale
    expect(apply(mul([...translate], [...scale]), 1, 1)).toEqual([22, 63]);
    expect(mul(IDENTITY, [...scale])).toEqual([...scale]);
  });

  it('bounds a rotated rectangle', () => {
    const rot90: [number, number, number, number, number, number] = [0, 1, -1, 0, 0, 0];
    expect(transformRect(rot90, 0, 0, 10, 20)).toEqual([-20, 0, 0, 10]);
  });

  it('computes a stroke scale', () => {
    expect(scaleOf([2, 0, 0, 8, 5, 5])).toBe(4);
  });
});

describe('boxes', () => {
  it('unions', () => {
    expect(union(null, [0, 0, 1, 1])).toEqual([0, 0, 1, 1]);
    expect(union([0, 0, 1, 1], [2, -1, 3, 0.5])).toEqual([0, -1, 3, 1]);
  });

  it('intersects with "no clip" (undefined) and "empty" (null) semantics', () => {
    expect(intersect(undefined, [0, 0, 1, 1])).toEqual([0, 0, 1, 1]);
    expect(intersect([0, 0, 1, 1], undefined)).toEqual([0, 0, 1, 1]);
    expect(intersect([0, 0, 10, 10], [5, 5, 20, 20])).toEqual([5, 5, 10, 10]);
    expect(intersect([0, 0, 1, 1], [2, 2, 3, 3])).toBeNull();
    expect(intersect(null, [0, 0, 1, 1])).toBeNull();
  });
});
