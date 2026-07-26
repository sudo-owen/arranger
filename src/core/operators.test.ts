import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PPQ, midi, pc, tick } from './brand.js';
import { makeRng } from './rng.js';
import { WEIGHTS_4_4 } from './meter.js';
import { motif } from './motif.js';
import type { Motif, Note } from './types.js';
import {
  type Context,
  augment, displace, invert, isStructural, octave, ornament, sequence, thin,
} from './operators.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

const STEP = PPQ / 4;         // 240 ticks — a 16th note
const LEN = tick(16 * STEP);  // one 4/4 bar

const CTX: Context = {
  key: { tonic: pc(0), mode: 'major' }, // C major
  harmony: [{ start: tick(0), duration: LEN, chord: { root: pc(0), quality: 'maj' } }],
  meter: { num: 4, den: 4 },
  weights: WEIGHTS_4_4,
};

/** Grid-aligned motifs: starts on the 16th grid, durations a whole number of 16ths. */
const arbMotif: fc.Arbitrary<Motif> = fc
  .integer({ min: 2, max: 6 })
  .chain((n) =>
    fc
      .record({
        slots: fc.uniqueArray(fc.integer({ min: 0, max: 15 }), { minLength: n, maxLength: n }),
        durs: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: n, maxLength: n }),
        pitches: fc.array(fc.integer({ min: 48, max: 84 }), { minLength: n, maxLength: n }),
        vels: fc.array(fc.integer({ min: 1, max: 127 }), { minLength: n, maxLength: n }),
      })
      .map(({ slots, durs, pitches, vels }): Motif => {
        const ordered = [...slots].sort((a, b) => a - b);
        const notes: Note[] = ordered.map((k, i) => ({
          start: tick(k * STEP),
          duration: tick((durs[i] ?? 1) * STEP),
          pitch: midi(pitches[i] ?? 60),
          velocity: vels[i] ?? 96,
        }));
        return motif(notes, LEN);
      }),
  );

function eq(a: Motif, b: Motif): boolean {
  if (a.length !== b.length || a.notes.length !== b.notes.length) return false;
  for (let i = 0; i < a.notes.length; i++) {
    const x = a.notes[i];
    const y = b.notes[i];
    if (x === undefined || y === undefined) return false;
    if (x.start !== y.start || x.duration !== y.duration || x.pitch !== y.pitch || x.velocity !== y.velocity) {
      return false;
    }
  }
  return true;
}

/** Onset+pitch keys of the notes that survive a max-weight thin — the structural skeleton. */
const skeleton = (m: Motif): string =>
  JSON.stringify(thin(m, CTX, 1).notes.map((n) => `${n.start}:${n.pitch}`).sort());

// ── the algebraic laws → free tests (spec §6.4) ──────────────────────────────

describe('operator algebra (spec §6.4)', () => {
  it('octave(n) ∘ octave(-n) = id', () => {
    fc.assert(fc.property(arbMotif, fc.constantFrom(-2, -1, 1, 2), (m, d) =>
      eq(octave(octave(m, d), -d), m),
    ));
  });

  it('displace(t) ∘ displace(-t) = id  (mod motif length)', () => {
    fc.assert(fc.property(arbMotif, fc.integer({ min: 0, max: 15 }), (m, k) => {
      const t = tick(k * STEP);
      return eq(displace(displace(m, t), tick(-t)), m);
    }));
  });

  it('augment(a/b) ∘ augment(b/a) = id  (grid-aligned)', () => {
    const ratios = [[2, 1], [3, 1], [3, 2], [4, 3]] as const;
    fc.assert(fc.property(arbMotif, fc.constantFrom(...ratios), (m, [a, b]) =>
      eq(augment(augment(m, a, b), b, a), m),
    ));
  });

  it('invert(a) ∘ invert(a) = id  (chromatic, fixed axis)', () => {
    fc.assert(fc.property(arbMotif, fc.integer({ min: 40, max: 90 }), (m, ax) => {
      const axis = midi(ax);
      return eq(invert(invert(m, CTX, axis, 'chromatic'), CTX, axis, 'chromatic'), m);
    }));
  });

  it('thin(0) = id', () => {
    fc.assert(fc.property(arbMotif, (m) => eq(thin(m, CTX, 0), m)));
  });

  it('ornament(0) = id', () => {
    fc.assert(fc.property(arbMotif, (m) =>
      eq(ornament(m, CTX, makeRng(1), 0, ['passing', 'neighbor']), m),
    ));
  });

  it('thin(1) ∘ ornament(d) ≈ thin(1)  (ornaments are all below threshold)', () => {
    fc.assert(fc.property(arbMotif, fc.double({ min: 0.1, max: 1, noNaN: true }), (m, d) => {
      const orn = ornament(m, CTX, makeRng(3), d, ['passing', 'neighbor', 'anticipation']);
      return skeleton(orn) === skeleton(m);
    }));
  });
});

describe('sequence', () => {
  it('count=1, interval=0 is identity; count multiplies length and note-count', () => {
    fc.assert(fc.property(arbMotif, (m) => {
      const one = sequence(m, CTX, 0, 1, 'chromatic');
      const three = sequence(m, CTX, 0, 3, 'chromatic');
      return eq(one, m)
        && three.length === tick(m.length * 3)
        && three.notes.length === m.notes.length * 3;
    }));
  });
});

describe('isStructural', () => {
  const note = (start: number, duration: number): Note =>
    ({ start: tick(start), duration: tick(duration), pitch: midi(60), velocity: 96 });

  it('is what the brass voicer harmonises: strong beats, long notes, phrase edges', () => {
    expect(isStructural(note(0, STEP), CTX)).toBe(true);            // downbeat
    expect(isStructural(note(STEP, STEP), CTX)).toBe(false);        // weak, short
    expect(isStructural(note(STEP, PPQ), CTX)).toBe(true);          // weak, but held a beat
    expect(isStructural(note(STEP, STEP), CTX, true)).toBe(true);   // phrase edge
  });
});
