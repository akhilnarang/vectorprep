/** Selection logic over the element tree (pure, no DOM). */
import type { Box, ElementDTO, ElementTreeDTO } from '../shared/types';
import { area, contains, inside, overlaps } from '../pdf/content/geometry';

export class ElementIndex {
  readonly nodes: ElementDTO[];
  /** the level at which plain clicks select (single-child wrappers are skipped) */
  readonly scope: ElementDTO;

  constructor(tree: ElementTreeDTO) {
    this.nodes = tree.nodes;
    this.scope = this.unwrap(this.node(0));
  }

  node(id: number): ElementDTO {
    const n = this.nodes[id];
    if (!n) throw new Error(`No element ${id}`);
    return n;
  }

  /** visible children with bounds */
  kids(n: ElementDTO): (ElementDTO & { b: Box })[] {
    return (n.ch ?? []).map((id) => this.node(id)).filter((c): c is ElementDTO & { b: Box } => !c.inv && !!c.b);
  }

  /** Descend through containers that hold exactly one visible container. */
  unwrap(n: ElementDTO): ElementDTO {
    for (let guard = 0; guard < 100; guard++) {
      const k = this.kids(n);
      const only = k[0];
      if (k.length === 1 && only && only.ch && only.ch.length) n = only;
      else break;
    }
    return n;
  }

  /** Elements under a point from the top level down (smallest box wins at each level). */
  chainAt(pt: [number, number]): ElementDTO[] {
    const list: ElementDTO[] = [];
    let n = this.scope;
    for (let depth = 0; depth < 60; depth++) {
      const cands = this.kids(n).filter((c) => contains(c.b, pt));
      let best = cands[0];
      if (!best) break;
      for (const c of cands) if (area(c.b) < area(best.b) || (area(c.b) === area(best.b) && c.id > best.id)) best = c;
      list.push(best);
      n = this.unwrap(best);
    }
    return list;
  }

  /** Alt-click: go one level below the deepest selected element in the chain. */
  drillTarget(list: ElementDTO[], selected: Set<number>): { from: ElementDTO | null; to: ElementDTO | null } {
    let k = -1;
    for (let i = 0; i < list.length; i++) if (selected.has(list[i]!.id)) k = i;
    if (k >= 0) return { from: list[k]!, to: list[k + 1] ?? list[k]! };
    return { from: null, to: list[1] ?? list[0] ?? null };
  }

  /** Largest elements that lie fully inside the rectangle. */
  marquee(r: Box): ElementDTO[] {
    const hits: ElementDTO[] = [];
    const walk = (n: ElementDTO) => {
      for (const c of this.kids(n)) {
        if (inside(c.b, r)) hits.push(c);
        else if (c.ch && c.ch.length && overlaps(c.b, r)) walk(this.unwrap(c));
      }
    };
    walk(this.scope);
    return hits;
  }

  isAncestor(a: ElementDTO, b: ElementDTO): boolean {
    for (let n: ElementDTO | null = b; n; n = n.p >= 0 ? this.node(n.p) : null) if (n.id === a.id) return true;
    return false;
  }

  /** Replace each element with its parent group (never above the top level). */
  parents(sel: Iterable<number>): Set<number> {
    const out = new Set<number>();
    for (const id of sel) {
      const n = this.node(id);
      let p = n.p >= 0 ? this.node(n.p) : null;
      while (p && p.p >= 0 && this.kids(this.node(p.p)).length === 1) p = this.node(p.p);
      if (!p || p.id === 0 || this.isAncestor(p, this.scope)) out.add(n.id);
      else out.add(p.id);
    }
    return out;
  }

  /** Replace each element with its visible children. */
  children(sel: Iterable<number>): Set<number> {
    const out = new Set<number>();
    for (const id of sel) {
      const n = this.node(id);
      const k = this.kids(this.unwrap(n));
      if (k.length) for (const c of k) out.add(c.id);
      else out.add(n.id);
    }
    return out;
  }

  /** The single visible image inside the selection, if there is exactly one. */
  singleImage(sel: Iterable<number>): ElementDTO | null {
    const imgs: ElementDTO[] = [];
    const walk = (n: ElementDTO) => {
      if (n.inv) return;
      if (n.k === 'image') imgs.push(n);
      for (const c of n.ch ?? []) walk(this.node(c));
    };
    for (const id of sel) walk(this.node(id));
    return imgs.length === 1 ? imgs[0]! : null;
  }

  bounds(sel: Iterable<number>): Box | null {
    let b: Box | null = null;
    for (const id of sel) {
      const nb = this.node(id).b;
      if (nb) b = b ? [Math.min(b[0], nb[0]), Math.min(b[1], nb[1]), Math.max(b[2], nb[2]), Math.max(b[3], nb[3])] : [...nb];
    }
    return b;
  }
}
