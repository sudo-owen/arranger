import type { Arrangement, Form, Genome, Key, Meter, Mood, Motif, Palette, Role } from '../core/index.js';
import { NEUTRAL_MOOD, TENOR_MOTION_ORDER, makeRng, pc } from '../core/index.js';
import { loopSeamProblems, violations } from '../critic/index.js';
import type { FormShape, Hook, Progression, VariationPlan } from '../generate/index.js';
import {
  arrange, barsForSeconds, deform, defaultProgression, generateHookSet, harmonyFromProgression,
  planForm, progressionForMood, renderHook, varySource, wholeForm,
} from '../generate/index.js';
import { fixtureGenome } from './fixtures.js';

export const METER: Meter = { num: 4, den: 4 };
export const KEY: Key = { tonic: pc(9), mode: 'minor' };

/** Every tempo the Mood stage offers. Generation must survive all of them. */
export const TEMPOS = [140, 155, 168, 185] as const;
export const BPM = 168;
export const LENGTHS = [30, 60, 90] as const;

/** A 5×5 sweep of the mood square, for "holds everywhere" properties. */
export const MOOD_GRID: Mood[] = (() => {
  const out: Mood[] = [];
  for (let u = 0; u <= 1.0001; u += 0.25) for (let f = 0; f <= 1.0001; f += 0.25) out.push({ urgency: u, fortune: f });
  return out;
})();

export const testHooks = (count: number, seed = 3): Hook[] => generateHookSet(KEY, METER, makeRng(seed), count);

/** A genome whose accompaniment varies per seed, the way the app's bed generator does. */
export function variedGenome(seed: number, over: Partial<Genome> = {}): Genome {
  const r = makeRng(seed);
  return fixtureGenome({
    bass: { seed: r.int(1e9), walkiness: r.next(), register: r.int(3) - 1 },
    tenor: { seed: r.int(1e9), motion: r.pick(TENOR_MOTION_ORDER), presence: 0.3 + r.next() * 0.5 },
    drums: { seed: r.int(1e9), fillDensity: 0.3 + r.next() * 0.5, swing: 0 },
    winds: { seed: r.int(1e9), activity: 0.3 + r.next() * 0.5 },
    brass: { seed: r.int(1e9), voicing: 'drop2', density: 0.3 + r.next() * 0.5 },
    ...over,
  });
}

export interface TrackOptions {
  hook?: Hook;
  /** Explicit bar count, or derive one from `seconds`. */
  bars?: number;
  seconds?: number;
  bpm?: number;
  palette?: Palette;
  mood?: Mood;
  /** A section plan; `shape` builds one at the resolved length. */
  form?: Form;
  shape?: FormShape;
  progression?: Progression;
  genome?: Genome;
  /** Per-section treatments; applied to the source before anything is arranged. */
  variation?: VariationPlan;
}

export interface Track {
  hook: Hook;
  bars: number;
  bpm: number;
  source: Motif;
  genome: Genome;
  progression: Progression;
  form: Form;
  arr: Arrangement;
}

/**
 * hook → source → harmony → arrange, which the generate suites were spelling out
 * thirteen times with three genome builders between them. Each of those tests varies
 * exactly one axis — palette, mood point, section shape — so the chain around it is
 * noise that hides which axis is under test.
 */
export function track(opts: TrackOptions = {}): Track {
  const hook = opts.hook ?? testHooks(1)[0]!;
  const bpm = opts.bpm ?? BPM;
  const bars = opts.bars ?? (opts.seconds !== undefined ? barsForSeconds(opts.seconds, bpm, METER) : 8);
  const mood = opts.mood ?? NEUTRAL_MOOD;
  const plain = renderHook(hook, bars);
  const progression = opts.progression
    ?? (opts.mood ? progressionForMood(KEY.mode, mood, null) : defaultProgression(KEY.mode));
  const harmony = harmonyFromProgression(progression, KEY, METER, bars);
  const form = opts.form ?? (opts.shape ? planForm(opts.shape, bars, METER) : wholeForm(harmony));
  const base = opts.genome ?? fixtureGenome();
  const genome = deform(opts.palette ? { ...base, palette: opts.palette } : base, mood);
  const source = varySource(plain, form, opts.variation, harmony, METER, genome);
  return {
    hook, bars, bpm, source, genome, progression, form,
    arr: arrange({ harmony, form, meter: METER, source, mood }, genome),
  };
}

/** Everything the critic objects to, including the loop seam. */
export const problemsFor = (t: Track, bpm = t.bpm): string[] =>
  [...violations(t.arr, t.source, bpm), ...loopSeamProblems(t.arr, METER)];

export const notesOf = (t: Track, role: Role): Motif['notes'] =>
  t.arr.tracks.find((x) => x.role === role)?.motif.notes ?? [];

/**
 * A line's identity, with the performance taken out of it.
 *
 * Velocity is a function of the form arc and the mood, so two renderings can be the same
 * music played at different dynamics — which is the point. Comparing raw notes conflates
 * "a different tune" with "the same tune, shaped", and only the first is ever a bug.
 */
export const tune = (notes: Motif['notes']): { start: number; duration: number; pitch: number }[] =>
  notes.map((n) => ({ start: n.start, duration: n.duration, pitch: n.pitch }));

export const velocities = (notes: Motif['notes']): number[] => notes.map((n) => n.velocity);
