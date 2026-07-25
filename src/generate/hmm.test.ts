import { describe, expect, it } from 'vitest';
import { PPQ, makeRng, midi, motif, pc, tick } from '../core/index.js';
import type { Key, Meter, Note } from '../core/index.js';
import { harmonyStates, inferHarmony, sampleHarmony } from './hmm.js';

const meter: Meter = { num: 4, den: 4 };
const BAR = PPQ * 4;
const cMajor: Key = { tonic: pc(0), mode: 'major' };

// Bar 1 outlines C (I), bar 2 outlines G7 (V7), bar 3 outlines C (I).
const bar = (start: number, pitches: readonly number[]): Note[] =>
  pitches.map((p, i) => ({ start: tick(start + i * PPQ), duration: tick(PPQ), pitch: midi(p), velocity: 90 }));
const source = motif([
  ...bar(0, [60, 64, 67, 64]),
  ...bar(BAR, [67, 71, 74, 65]),
  ...bar(2 * BAR, [64, 67, 72, 60]),
]);

const roots = (h: ReturnType<typeof inferHarmony>) => h.events.map((e) => e.chord.root);

describe('HMM harmony inference (spec §7.2)', () => {
  it('produces contiguous, gap-free harmony covering [0, length)', () => {
    const h = inferHarmony(source, cMajor, meter);
    expect(h.events[0]?.start).toBe(0);
    for (let i = 1; i < h.events.length; i++) {
      const prev = h.events[i - 1]!;
      expect(h.events[i]!.start).toBe(prev.start + prev.duration);
    }
    const last = h.events[h.events.length - 1]!;
    expect(last.start + last.duration).toBe(h.length);
  });

  it('Viterbi is deterministic', () => {
    expect(inferHarmony(source, cMajor, meter)).toEqual(inferHarmony(source, cMajor, meter));
  });

  it('finds a plausible I–V–I shape (tonic, dominant, tonic)', () => {
    const r = roots(inferHarmony(source, cMajor, meter));
    expect(r[0]).toBe(0); // C over a C-outlining bar
    expect(r[1]).toBe(7); // G over a G7-outlining bar
    expect(r[2]).toBe(0); // back to C
  });

  it('FFBS is deterministic per seed', () => {
    const a = sampleHarmony(source, cMajor, meter, 1.0, makeRng(5));
    const b = sampleHarmony(source, cMajor, meter, 1.0, makeRng(5));
    expect(a).toEqual(b);
  });

  it('temperature opens up variation (distinct progressions across seeds)', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 16; s++) {
      const h = sampleHarmony(source, cMajor, meter, 2.0, makeRng(s));
      seen.add(h.events.map((e) => `${String(e.chord.root)}${e.chord.quality}`).join('|'));
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('the chord vocabulary is capped and includes the essentials', () => {
    const states = harmonyStates(cMajor);
    expect(states.length).toBeLessThanOrEqual(30);
    expect(states.some((c) => c.root === 0 && c.quality === 'maj')).toBe(true); // I
    expect(states.some((c) => c.root === 7 && c.quality === 'dom7')).toBe(true); // V7
  });
});
