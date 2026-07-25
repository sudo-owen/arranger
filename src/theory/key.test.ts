import { describe, expect, it } from 'vitest';
import { PPQ, midi, motif, tick } from '../core/index.js';
import type { Note } from '../core/index.js';
import { detectKey } from './key.js';

const Q = PPQ;
const seq = (pairs: readonly [number, number][]): Note[] => {
  let t = 0;
  const out: Note[] = [];
  for (const [p, beats] of pairs) {
    out.push({ start: tick(t), duration: tick(beats * Q), pitch: midi(p), velocity: 90 });
    t += beats * Q;
  }
  return out;
};

// "Twinkle Twinkle" — unambiguous major, tonic at start and end.
const twinkleC: [number, number][] = [
  [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
  [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
];

describe('Krumhansl–Schmuckler key detection', () => {
  it('finds C major in a C-major tune', () => {
    const k = detectKey(motif(seq(twinkleC)));
    expect(k.tonic).toBe(0);
    expect(k.mode).toBe('major');
  });

  it('is transposition-equivariant (same tune up a 4th → F major)', () => {
    const twinkleF = twinkleC.map(([p, b]): [number, number] => [p + 5, b]);
    const k = detectKey(motif(seq(twinkleF)));
    expect(k.tonic).toBe(5);
    expect(k.mode).toBe('major');
  });

  it('finds A minor from a harmonic-minor line (the G# is the tell)', () => {
    const aMinor: [number, number][] = [
      [69, 2], [71, 1], [72, 1], [74, 1], [76, 2], [77, 1], [68, 1], [69, 2],
    ];
    const k = detectKey(motif(seq(aMinor)));
    expect(k.tonic).toBe(9);
    expect(k.mode).toBe('minor');
  });
});
