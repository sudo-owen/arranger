import type { Midi, Tick } from './brand.js';
import { PPQ, midi, tick } from './brand.js';
import type { Rng } from './rng.js';
import type { ChordEvent, Instrument, Key, Meter, Motif, Note } from './types.js';
import { motif } from './motif.js';
import { normWeightAt } from './meter.js';
import { minArticulation } from './instruments.js';
import {
  fromDiatonicDegree,
  toDiatonicDegree,
  transposeChromatic,
  transposeDiatonic,
} from './pitch.js';

// ─── Context ─────────────────────────────────────────────────────────────────

/**
 * Everything an operator needs to stay inside the tonal grammar. NOT optional
 * (spec §6.2): without `harmony`, ornament can't tell consonant tones from garbage;
 * without `weights`, thin has no threshold; without `key`, diatonic motion is
 * impossible. Get this wrong now and you retrofit it through every operator later.
 */
export interface Context {
  key: Key;
  harmony: readonly ChordEvent[]; // covers this motif's span, contiguous
  meter: Meter;
  weights: readonly number[];
  instrument?: Instrument;
}

// ─── Operator algebra (spec §6.1) ────────────────────────────────────────────

export type PitchSpace = 'chromatic' | 'diatonic';
export type OrnamentKind =
  | 'passing' | 'neighbor' | 'turn' | 'mordent' | 'anticipation';

export type Operator =
  | { kind: 'ornament'; density: number; kinds: OrnamentKind[] }
  | { kind: 'thin'; threshold: number }
  | { kind: 'sequence'; interval: number; count: number; space: PitchSpace }
  | { kind: 'displace'; ticks: Tick }
  | { kind: 'augment'; num: number; den: number }
  | { kind: 'octave'; delta: -2 | -1 | 1 | 2 }
  | { kind: 'invert'; axis: Midi | 'first' | 'centroid'; space: PitchSpace };

/**
 * The single dispatch point (spec §6.3). Add operator #8 and the compiler hands you
 * every site that needs updating via the `never` check below — the one Rust
 * guarantee TS genuinely replicates, and only with `any`/`as` banned.
 */
export function apply(op: Operator, m: Motif, ctx: Context, rng: Rng): Motif {
  switch (op.kind) {
    case 'ornament': return ornament(m, ctx, rng, op.density, op.kinds);
    case 'thin':     return thin(m, ctx, op.threshold);
    case 'sequence': return sequence(m, ctx, op.interval, op.count, op.space);
    case 'displace': return displace(m, op.ticks);
    case 'augment':  return augment(m, op.num, op.den);
    case 'octave':   return octave(m, op.delta);
    case 'invert':   return invert(m, ctx, op.axis, op.space);
    default: {
      const _never: never = op;
      throw new Error(`unhandled operator: ${JSON.stringify(_never)}`);
    }
  }
}

// ─── Structural-preserving operators (pure, ctx-free) ────────────────────────

/** Shift every pitch by whole octaves. No clamp (keeps octave(n)∘octave(-n)=id). */
export function octave(m: Motif, delta: number): Motif {
  return motif(m.notes.map((n) => ({ ...n, pitch: midi(n.pitch + 12 * delta) })), m.length);
}

/** Rotate the motif in time by `delta`, wrapping within [0, length). Reversible mod length. */
export function displace(m: Motif, delta: Tick): Motif {
  const L = m.length;
  if (L <= 0) return m;
  return motif(
    m.notes.map((n) => ({ ...n, start: tick((((n.start + delta) % L) + L) % L) })),
    m.length,
  );
}

/**
 * Scale time by num/den. Integer tick math (round), NOT float — float arithmetic
 * yields notes at tick 1919.9999 and 1-tick gaps that click at tempo (spec §6.1).
 * Exactly reversible for grid-aligned inputs; off-grid inputs expose the rounding
 * boundary the property test in §6.4 is designed to find.
 */
export function augment(m: Motif, num: number, den: number): Motif {
  if (den === 0) throw new Error('augment: den must be non-zero');
  const s = (t: number): Tick => tick(Math.round((t * num) / den));
  return motif(
    m.notes.map((n) => ({ ...n, start: s(n.start), duration: s(n.duration) })),
    s(m.length),
  );
}

// ─── Surface operators (need Context) ─────────────────────────────────────────

/** Drop notes whose normalised metric weight is below `threshold` (0–1). thin(0)=id. */
export function thin(m: Motif, ctx: Context, threshold: number): Motif {
  return motif(
    m.notes.filter((n) => normWeightAt(n.start, ctx.meter, ctx.weights) >= threshold),
    m.length,
  );
}

/** Tile the motif `count` times, each copy transposed by `interval` (per `space`). */
export function sequence(
  m: Motif, ctx: Context, interval: number, count: number, space: PitchSpace,
): Motif {
  if (count <= 0) return motif([], tick(0));
  const out: Note[] = [];
  for (let i = 0; i < count; i++) {
    const shift = interval * i;
    const offset = m.length * i;
    for (const n of m.notes) {
      const pitch = space === 'chromatic'
        ? transposeChromatic(n.pitch, shift)
        : transposeDiatonic(n.pitch, ctx.key, shift);
      out.push({ ...n, start: tick(n.start + offset), pitch });
    }
  }
  return motif(out, tick(m.length * count));
}

/** Reflect pitches about an axis. Chromatic is exact; diatonic reflects in degree space. */
export function invert(
  m: Motif, ctx: Context, axis: Midi | 'first' | 'centroid', space: PitchSpace,
): Motif {
  const a = resolveAxis(m, axis);
  return motif(m.notes.map((n) => ({ ...n, pitch: reflect(n.pitch, a, ctx.key, space) })), m.length);
}

function resolveAxis(m: Motif, axis: Midi | 'first' | 'centroid'): number {
  if (axis === 'first') {
    const first = m.notes[0];
    return first === undefined ? 60 : first.pitch;
  }
  if (axis === 'centroid') {
    if (m.notes.length === 0) return 60;
    return Math.round(m.notes.reduce((sum, n) => sum + n.pitch, 0) / m.notes.length);
  }
  return axis;
}

function reflect(pitch: Midi, axis: number, key: Key, space: PitchSpace): Midi {
  if (space === 'chromatic') return midi(2 * axis - pitch);
  const axisDeg = toDiatonicDegree(midi(Math.round(axis)), key);
  return fromDiatonicDegree(2 * axisDeg - toDiatonicDegree(pitch, key), key);
}

// ─── Ornament (spec §6.1 — ~80% of the value; build it well) ──────────────────

/** Fallback when the context names no instrument: a 32nd. */
const MIN_SPLIT = PPQ / 8;

/**
 * Adds surface decoration between structural notes. To keep the §6.4 law
 * `thin(1) ∘ ornament(d) ≈ thin(1)`, every added note sits at a WEAK metric
 * position (checked below), so a max-weight thin cleanly strips it and the
 * structural skeleton returns. Existing note onsets and pitches are never altered
 * — a decorated note only has its tail shortened. ornament(0) = id, exactly.
 *
 * NOTE: pitch choices are currently diatonic (key-based). Harmony-aware selection
 * (preferring chord tones at stronger sub-positions) is the intended refinement —
 * ctx already carries `harmony` for it. turn/mordent are simplified to a single
 * neighbour for v1; real multi-note figures come with the taste pass.
 */
export function ornament(
  m: Motif, ctx: Context, rng: Rng, density: number, kinds: OrnamentKind[],
): Motif {
  if (density <= 0 || kinds.length === 0) return motif([...m.notes], m.length);
  // Never subdivide below what the voice can articulate. Ornamenting halves a note, so
  // decorating a line of sixteenths writes thirty-seconds — 22 notes/sec, past any
  // wind or brass player. The critic caught this after the fact and rejected the whole
  // arrangement; the honest fix is not to write the figure in the first place.
  const minSplit = ctx.instrument ? minArticulation(ctx.instrument) : MIN_SPLIT;
  const out: Note[] = [];
  const ns = m.notes;
  for (let i = 0; i < ns.length; i++) {
    const a = ns[i];
    if (a === undefined) continue;
    const b = ns[i + 1];
    if (b !== undefined && rng.bool(density)) {
      const half = Math.floor(a.duration / 2);
      const ornStart = tick(a.start + half);
      const ornDur = a.duration - half;
      const weak = normWeightAt(ornStart, ctx.meter, ctx.weights) < 1;
      const p = ornamentPitch(rng.pick(kinds), a, b, ctx.key, rng);
      if (half >= minSplit && ornDur > 0 && weak && p !== null) {
        out.push({ ...a, duration: tick(half) });
        out.push({ start: ornStart, duration: tick(ornDur), pitch: p, velocity: Math.round(a.velocity * 0.8) });
        continue;
      }
    }
    out.push(a);
  }
  return motif(out, m.length);
}

function ornamentPitch(kind: OrnamentKind, a: Note, b: Note, key: Key, rng: Rng): Midi | null {
  const da = toDiatonicDegree(a.pitch, key);
  const db = toDiatonicDegree(b.pitch, key);
  switch (kind) {
    case 'passing':
      return da === db ? null : fromDiatonicDegree(da + (db > da ? 1 : -1), key);
    case 'anticipation':
      return b.pitch;
    case 'neighbor':
    case 'turn':    // simplified: single neighbour for v1
    case 'mordent': // TODO §6.1: real multi-note turn/mordent figures
      return fromDiatonicDegree(da + (rng.bool() ? 1 : -1), key);
    default: {
      const _never: never = kind;
      throw new Error(`unhandled ornament kind: ${JSON.stringify(_never)}`);
    }
  }
}
