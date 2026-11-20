import { describe, expect, it } from 'vitest';
import { buildTree, toDTO } from '../../src/pdf/content/elements';
import { ElementIndex } from '../../src/viewer/tree';
import { buildElementsDoc } from './fixtures';

const round = (b: number[] | null) => b && b.map((v) => Math.round(v * 100) / 100);

describe('element tree', async () => {
  const { doc } = await buildElementsDoc();
  const tree = buildTree(doc, 0);
  const top = tree.root.children!;

  it('finds the top-level elements in content order', () => {
    expect(top.map((n) => n.k)).toEqual(['block', 'path', 'block', 'block', 'block', 'form', 'block', 'text']);
  });

  it('computes bounds through cm, line width and clipping', () => {
    expect(round(top[0]!.bbox)).toEqual([100, 100, 110, 120]);
    expect(round(top[1]!.bbox)).toEqual([9, 9, 31, 11]);
    expect(top[2]!.inv).toBe(true); // painted entirely outside its clip
    expect(round(top[3]!.bbox)).toEqual([50, 50, 70, 70]);
    expect(round(top[4]!.bbox)).toEqual([160, 160, 190, 190]);
  });

  it('descends into form XObjects with the form matrix', () => {
    const form = top[5]!;
    expect(form.children!.map((n) => n.k)).toEqual(['path', 'block']);
    expect(round(form.children![0]!.bbox)).toEqual([145, 15, 155, 25]);
    expect(round(form.children![1]!.bbox)).toEqual([160, 30, 170, 40]);
    expect(round(form.bbox)).toEqual([145, 15, 170, 40]);
  });

  it('marks fully transparent paint as invisible and text as approximate', () => {
    expect(top[6]!.inv).toBe(true);
    expect(top[7]!.approx).toBe(true);
    expect(top[7]!.bbox![0]).toBeCloseTo(20);
  });

  it('supports hit testing, drilling and marquee in the viewer model', () => {
    const idx = new ElementIndex(toDTO(tree, 0));
    expect(idx.scope.id).toBe(0);
    const chain = idx.chainAt([165, 35]);
    expect(chain.map((n) => n.k)).toEqual(['form', 'block', 'path']);
    // first alt-click goes one level deeper than a plain click
    expect(idx.drillTarget(chain, new Set()).to!.id).toBe(chain[1]!.id);
    expect(idx.drillTarget(chain, new Set([chain[1]!.id])).to!.id).toBe(chain[2]!.id);
    // marquee picks the largest elements fully inside
    const hits = idx.marquee([140, 10, 175, 45]);
    expect(hits.map((n) => n.k)).toEqual(['form']);
    const inner = idx.marquee([158, 28, 172, 42]);
    expect(inner.map((n) => n.k)).toEqual(['block']);
    expect(idx.singleImage([top[4]!.id])!.k).toBe('image');
  });
});
