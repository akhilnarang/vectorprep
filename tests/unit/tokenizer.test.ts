import { describe, expect, it } from 'vitest';
import { bytesToLatin1, decodeName, latin1ToBytes, tokenize } from '../../src/pdf/content/tokenizer';

describe('tokenize', () => {
  it('splits operands and operators', () => {
    const ops = tokenize('q 1 0 0 1 10.5 -2 cm /GS0 gs 0 0 10 20 re f Q');
    expect(ops.map((o) => o.op)).toEqual(['q', 'cm', 'gs', 're', 'f', 'Q']);
    expect(ops[1]!.args.map((a) => a.v)).toEqual([1, 0, 0, 1, 10.5, -2]);
    expect(ops[2]!.args[0]).toMatchObject({ t: 'name', raw: '/GS0', v: 'GS0' });
  });

  it('keeps strings, hex strings, arrays and dicts as single raw operands', () => {
    const src = '[(a\\)b) 120 <00FF> (x(y)z)] TJ /P <</MCID 3 /Sub [1 2]>> BDC (Hi\\n) Tj';
    const ops = tokenize(src);
    expect(ops.map((o) => o.op)).toEqual(['TJ', 'BDC', 'Tj']);
    expect(ops[0]!.args).toHaveLength(1);
    expect(ops[0]!.args[0]).toMatchObject({ t: 'arr', raw: '[(a\\)b) 120 <00FF> (x(y)z)]' });
    expect(ops[1]!.args[1]).toMatchObject({ t: 'dict', raw: '<</MCID 3 /Sub [1 2]>>' });
    expect(ops[2]!.args[0]!.raw).toBe('(Hi\\n)');
  });

  it('decodes #xx escapes in names', () => {
    expect(decodeName('/A#20B')).toBe('A B');
    expect(tokenize('/Fm#230 Do')[0]!.args[0]!.v).toBe('Fm#0');
  });

  it('skips comments', () => {
    expect(tokenize('% comment q\n0 g % another\nf').map((o) => o.op)).toEqual(['g', 'f']);
  });

  it('reads inline images as one operation, including binary data that looks like operators', () => {
    const src = 'q BI /W 2 /H 1 /BPC 8 /CS /G ID \x00Q EI\x01 EI Q';
    const ops = tokenize(src);
    expect(ops.map((o) => o.op)).toEqual(['q', 'BI', 'Q']);
    expect(ops[1]).toMatchObject({ w: 2, h: 1 });
    expect(ops[1]!.raw).toBe('BI /W 2 /H 1 /BPC 8 /CS /G ID \x00Q EI\x01 EI');
  });

  it('round-trips bytes through latin1 strings', () => {
    const b = new Uint8Array(256).map((_, i) => i);
    expect(latin1ToBytes(bytesToLatin1(b))).toEqual(b);
  });
});
