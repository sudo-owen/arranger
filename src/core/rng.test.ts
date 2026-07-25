import { describe, expect, it } from 'vitest';
import { makeRng } from './rng.js';

describe('rng (sfc32)', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    expect(makeRng(1).next()).not.toEqual(makeRng(2).next());
  });

  it('next() stays in [0, 1)', () => {
    const r = makeRng(123);
    for (let i = 0; i < 5000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('int() stays in [0, max)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 2000; i++) {
      const x = r.int(10);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(10);
    }
  });

  it('fork(label) is reproducible and label-dependent', () => {
    expect(makeRng(1).fork('a').next()).toEqual(makeRng(1).fork('a').next());
    expect(makeRng(1).fork('a').next()).not.toEqual(makeRng(1).fork('b').next());
  });

  it('fork(label) is INDEPENDENT of parent consumption (spec §8.2)', () => {
    // The bug the spec warns about: draining the parent must not change the child.
    const parent = makeRng(99);
    const before = parent.fork('melody').next();
    parent.next(); parent.next(); parent.next(); parent.int(50);
    const after = parent.fork('melody').next();
    expect(after).toEqual(before);
  });

  it('pick() throws on empty input', () => {
    expect(() => makeRng(0).pick([])).toThrow();
  });
});
