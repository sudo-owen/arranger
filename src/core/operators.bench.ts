import fc from 'fast-check';
import { bench } from 'vitest';
import { PPQ, midi, pc, tick } from './brand.js';
import { makeRng } from './rng.js';
import { WEIGHTS_4_4 } from './meter.js';
import { motif } from './motif.js';
import type { Motif } from './types.js';
import { type Context, apply } from './operators.js';

const CTX: Context = {
  key: { tonic: pc(0), mode: 'major' },
  harmony: [{ start: tick(0), duration: tick(16 * (PPQ / 4)), chord: { root: pc(0), quality: 'maj' } }],
  meter: { num: 4, den: 4 },
  weights: WEIGHTS_4_4,
};

// A dense 16-note bar, the kind of thing a role generator emits.
const m: Motif = motif(
  Array.from({ length: 16 }, (_, i) => ({
    start: tick(i * (PPQ / 4)),
    duration: tick(PPQ / 4),
    pitch: midi(60 + (i % 8)),
    velocity: 96,
  })),
);

const rng = makeRng(1);

// A representative development chain applied per candidate (spec §7.3-style).
bench('operator chain over one bar', () => {
  let x = apply({ kind: 'ornament', density: 0.5, kinds: ['passing', 'neighbor'] }, m, CTX, rng);
  x = apply({ kind: 'sequence', interval: -1, count: 2, space: 'diatonic' }, x, CTX, rng);
  x = apply({ kind: 'augment', num: 3, den: 2 }, x, CTX, rng);
  x = apply({ kind: 'thin', threshold: 0.5 }, x, CTX, rng);
  fc.constant(x); // keep the optimizer honest
});
