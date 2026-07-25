import { describe, expect, it } from 'vitest';
import { PPQ, WEIGHTS_4_4, midi, pc, tick } from '../core/index.js';
import type { Context, Note } from '../core/index.js';
import { classifyNote, isStructural } from './nct.js';

const Q = PPQ;
const CTX: Context = {
  key: { tonic: pc(0), mode: 'major' },
  harmony: [{ start: tick(0), duration: tick(16 * Q), chord: { root: pc(0), quality: 'maj' } }],
  meter: { num: 4, den: 4 },
  weights: WEIGHTS_4_4,
};
const n = (pitch: number, start: number, dur = Q / 4): Note =>
  ({ start: tick(start), duration: tick(dur), pitch: midi(pitch), velocity: 90 });

describe('non-chord-tone classification (spec §7.1)', () => {
  it('a chord tone is labelled chordTone', () => {
    expect(classifyNote(n(60, 0), n(64, Q), n(67, 2 * Q), CTX)).toBe('chordTone'); // E in C
  });
  it('stepwise-through is passing', () => {
    expect(classifyNote(n(60, 0), n(62, Q / 2), n(64, Q), CTX)).toBe('passing'); // D between C,E
  });
  it('step-away-and-back is neighbor', () => {
    expect(classifyNote(n(60, 0), n(62, Q / 2), n(60, Q), CTX)).toBe('neighbor'); // C-D-C
  });
  it('held-then-falls is suspension', () => {
    expect(classifyNote(n(65, 0), n(65, Q / 2), n(64, Q), CTX)).toBe('suspension'); // F→E
  });

  it('isStructural: downbeat yes, weak short offbeat no', () => {
    expect(isStructural(n(60, 0), CTX)).toBe(true);           // beat 1, weight 4
    expect(isStructural(n(62, Q / 4), CTX)).toBe(false);      // a 16th offbeat, short
  });
});
