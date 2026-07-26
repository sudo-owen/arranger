import type { Context, Form, Genome, Meter, Mood, Motif, Note, Rng, SectionLabel, Tick } from '../core/index.js';
import {
  PALETTES, PPQ, augment, beatTicks, fromDiatonicDegree, makeRng, motif, octave, ornament,
  sliceAt, thin, tick, tileTo, toDiatonicDegree, weightsFor,
} from '../core/index.js';
import type { Harmony } from '../core/index.js';
import { CONTOUR_FLOOR, contourSimilarity } from '../theory/index.js';

/**
 * What happens to the hook each time it comes back.
 *
 * Everything upstream of here works hard to make one motif recur — that is what makes
 * a battle theme a theme. But `renderHook` tiles the same statement across every bar,
 * so a 90-second track plays byte-identical melody notes twenty-two times. The form
 * stage varies density around it; the tune itself never moves. This is the stage that
 * moves it, and the constraint is narrow: different enough to notice, close enough
 * that it is still the hook you chose.
 *
 * A treatment is a bounded chain over the operators in `core` — they already carry the
 * algebraic laws (§6.4) that keep a transformation reversible and grid-aligned, which
 * is what stops "variation" from becoming "a different tune".
 */

export type TreatmentId =
  | 'as-written' | 'thinned' | 'ornamented' | 'octave-up' | 'octave-down'
  | 'answered' | 'double-time';

export interface Treatment {
  id: TreatmentId;
  label: string;
  blurb: string;
  apply: (m: Motif, ctx: Context, rng: Rng) => Motif;
}

/**
 * How strongly `after` still reads as `before`.
 *
 * Contour similarity samples each motif across its OWN length, so it is already blind to
 * a uniform time-scaling — `augment(m, 1, 2)` scores exactly 1 against `m`. What it
 * cannot see through is a REPEAT: two statements against one score near zero. Taking the
 * better of "as a whole" and "just the first statement" covers both, and — unlike a
 * `repeats` count declared on the treatment — stays honest when a treatment degrades and
 * does not end up doubling after all.
 */
export function kinship(after: Motif, before: Motif): number {
  const whole = contourSimilarity(after, before);
  const first = sliceAt(after, 0, Math.floor(after.length / 2));
  return first.notes.length >= 2 ? Math.max(whole, contourSimilarity(first, before)) : whole;
}

/**
 * The first candidate that still reads as `m` — how a treatment with a knob bounds
 * itself, rather than leaving `variationProblems` to reject the whole scheme after the
 * fact. Candidates go boldest-first, so this takes the strongest move that survives.
 */
const stillKin = (m: Motif, candidates: readonly Motif[]): Motif | undefined =>
  candidates.find((c) => c.notes.length >= 2 && kinship(c, m) >= CONTOUR_FLOOR);

/** Smallest gap between consecutive onsets — what decides whether a figure is playable. */
function tightestOnset(m: Motif): number {
  let min = Infinity;
  for (let i = 1; i < m.notes.length; i++) min = Math.min(min, m.notes[i]!.start - m.notes[i - 1]!.start);
  return min;
}

/**
 * Keep the phrase, turn its tail down — the same gesture the hook's own `answer`
 * scheme makes, applied to a whole recurrence. Inversion was the first attempt and it
 * is too violent a move at this scale: reflecting even a quarter of the section puts
 * the syncopated figures through the kinship floor. Rhythm is untouched either way.
 */
function answer(m: Motif, ctx: Context): Motif {
  const from = Math.floor((m.length * 3) / 4);
  return motif(m.notes.map((n) => (n.start < from ? n : {
    ...n, pitch: fromDiatonicDegree(toDiatonicDegree(n.pitch, ctx.key) - 2, ctx.key),
  })), m.length);
}

/**
 * Snap onsets back to the sixteenth grid the hook lives on, dropping collisions.
 *
 * `ornament` subdivides, and against material that is already sixteenths it writes
 * thirty-seconds. `generateMelody` quantises to sixteenths anyway, so those notes are
 * silently discarded downstream — decoration computed, paid for, and thrown away. Doing
 * it here means what a treatment returns is what the track will actually play.
 */
function toGrid(m: Motif, grid: number): Motif {
  const onGrid = (n: Note): boolean => n.start % grid === 0;
  const taken = new Set<number>();
  const out: Note[] = [];
  // Notes already on the grid claim their slot first. Letting an ornament round onto an
  // occupied sixteenth and evict the note it was decorating is how a treatment quietly
  // eats the skeleton it was supposed to be embellishing.
  for (const n of [...m.notes.filter(onGrid), ...m.notes.filter((n2) => !onGrid(n2))]) {
    const start = Math.round(n.start / grid) * grid;
    if (taken.has(start) || start >= m.length) continue;
    taken.add(start);
    out.push({ ...n, start: tick(start), duration: tick(Math.max(grid, Math.min(n.duration, m.length - start))) });
  }
  return motif(out, m.length);
}

/**
 * Half the note values, stated twice. Applied to the whole line this writes
 * thirty-seconds no wind player could tongue, so it runs over the thinned skeleton —
 * which is also the better musical reading: the climax drives the bones of the hook,
 * it does not gabble its ornaments.
 */
function doubleTime(m: Motif, ctx: Context): Motif {
  // Least thinning first, so the boldest surviving candidate is also the most faithful:
  // only skeletons with room to halve are considered, and of those the first that still
  // reads as the hook wins.
  const roomToHalve = [0, 0.3, 0.5, 0.75]
    .map((threshold) => thin(m, ctx, threshold))
    .filter((bones) => tightestOnset(bones) >= PPQ / 2);
  const chosen = stillKin(m, roomToHalve);
  return chosen ? augment(chosen, 1, 2) : m;
}

export const TREATMENTS: readonly Treatment[] = [
  {
    id: 'as-written', label: 'As written', blurb: 'the statement unchanged',
    apply: (m) => m,
  },
  {
    id: 'thinned', label: 'Thinned', blurb: 'strong beats only — the hook’s bones',
    // Thin as hard as the section can bear, not to a fixed threshold. A four-bar intro
    // stripped to strong beats keeps too few notes to still read as the hook, which lost
    // three of the five schemes outright on about one hook in eight — the shortest
    // section deciding whether the whole track's plan was offered at all.
    apply: (m, ctx) => stillKin(m, [0.5, 0.35, 0.25].map((t) => thin(m, ctx, t))) ?? m,
  },
  {
    id: 'ornamented', label: 'Ornamented', blurb: 'the same skeleton with more surface',
    apply: (m, ctx, rng) => ornament(m, ctx, rng, 0.55, ['passing', 'neighbor', 'turn']),
  },
  {
    id: 'octave-up', label: 'Octave up', blurb: 'same tune, one register brighter',
    apply: (m) => octave(m, 1),
  },
  {
    id: 'octave-down', label: 'Octave down', blurb: 'same tune, one register darker',
    apply: (m) => octave(m, -1),
  },
  {
    id: 'answered', label: 'Answered', blurb: 'phrase kept, its tail turned down a step',
    apply: (m, ctx) => answer(m, ctx),
  },
  {
    id: 'double-time', label: 'Double time', blurb: 'the skeleton at half the note values, stated twice',
    apply: (m, ctx) => doubleTime(m, ctx),
  },
];

export const treatmentById = (id: TreatmentId): Treatment =>
  TREATMENTS.find((t) => t.id === id) ?? TREATMENTS[0]!;

/**
 * Which treatment each section gets. Keyed by label because labels are unique within a
 * form and legible in a spec file — `{"A''": "octave-up"}` says what it does.
 */
export type VariationPlan = Partial<Readonly<Record<SectionLabel, TreatmentId>>>;

export interface VariationScheme {
  id: string;
  label: string;
  blurb: string;
  plan: VariationPlan;
}

export const VARIATION_SCHEMES: readonly VariationScheme[] = [
  {
    id: 'straight', label: 'Straight', blurb: 'every return identical — the baseline to compare against',
    plan: {},
  },
  {
    id: 'terraced', label: 'Terraced', blurb: 'each return adds a layer; the climax lifts an octave',
    plan: { intro: 'thinned', "A'": 'ornamented', B: 'thinned', 'A"': 'octave-up' },
  },
  {
    id: 'call-answer', label: 'Call and answer', blurb: 'the middle turns down before the hook comes back',
    plan: { intro: 'octave-down', "A'": 'answered', B: 'octave-down', 'A"': 'ornamented', tag: 'thinned' },
  },
  {
    id: 'driving', label: 'Driving', blurb: 'holds back, then takes the hook double-time at the peak',
    plan: { intro: 'thinned', "A'": 'ornamented', B: 'answered', 'A"': 'double-time' },
  },
  {
    id: 'inverted-arc', label: 'Inverted arc', blurb: 'opens high and bright, falls away into the tag',
    plan: { intro: 'octave-up', A: 'octave-up', "A'": 'ornamented', B: 'answered', tag: 'octave-down' },
  },
];

/**
 * The treatments ordered by how much the hook asserts itself, least first.
 *
 * Only density belongs on this ladder. Putting the register moves on it too made the
 * climax come back THINNER at the triumphant corner — `octave-up` sat at the desperate
 * end, because a thin line climbing is strained, and stepping the other way then walked
 * it down into `thinned`. Register and assertion are different axes; an authored
 * `octave-up`, `octave-down` or `double-time` is a deliberate statement and is left alone.
 */
export const FORTUNE_LADDER: readonly TreatmentId[] = ['thinned', 'answered', 'as-written', 'ornamented'];

/**
 * The one exception, and the reason the plan pairs "thinning and register climb": a hook
 * already stripped to its bones has nowhere further down to go, so at the desperate
 * extreme it strains upward instead.
 */
const AT_THE_BOTTOM: TreatmentId = 'octave-up';

/** Outside this band the fight is going decisively one way, and the hook should say so. */
const DECISIVE = 0.25;

/**
 * Bend an authored plan toward how the fight is going.
 *
 * The plan is what the author chose; this is the adaptive half, and like `deform` it
 * BIASES rather than assigns — one rung along the ladder, never a wholesale rewrite, and
 * exactly nothing between the two thresholds. `variationForMood(p, f, NEUTRAL_MOOD)`
 * returning `p` unchanged is what keeps the Vary stage an honest audition: what you hear
 * while authoring is the plan you wrote.
 *
 * This is also why the fight arcs change the tune and not merely the mix. Layer gains
 * move the balance and `deform` moves the densities; without this the melody itself
 * played on regardless of whether you were winning.
 */
export function variationForMood(plan: VariationPlan, form: Form, mood: Mood): VariationPlan {
  const step = mood.fortune < DECISIVE ? -1 : mood.fortune > 1 - DECISIVE ? 1 : 0;
  if (step === 0) return plan;
  const out: Record<string, TreatmentId> = { ...plan };
  for (const s of form.sections) {
    const at = FORTUNE_LADDER.indexOf(plan[s.label] ?? 'as-written');
    if (at < 0) continue; // off-ladder: a deliberate register or tempo statement
    out[s.label] = at + step < 0
      ? AT_THE_BOTTOM
      : FORTUNE_LADDER[Math.min(FORTUNE_LADDER.length - 1, at + step)]!;
  }
  return out;
}

/** Whether a plan asks for anything at all. `varySource` short-circuits on it. */
export const isStraight = (plan: VariationPlan | undefined): boolean =>
  !plan || Object.values(plan).every((t) => t === undefined || t === 'as-written');

/**
 * Rewrite the hook section by section under `plan`.
 *
 * Runs BEFORE `arrange`, on the source rather than on the written melody, so every
 * downstream role answers the variation rather than the statement: winds fill the gaps
 * a thinned section opens, brass harmonises the line that is actually there. Treating
 * the melody track afterwards would leave the other four voices playing to a tune that
 * is no longer sounding.
 */
export function varySource(
  source: Motif, form: Form, plan: VariationPlan | undefined, harmony: Harmony,
  meter: Meter, genome: Genome,
): Motif {
  if (!form.sections.length || isStraight(plan)) return source;
  // Naming the lead is what lets `ornament` clamp itself: without it the operator falls
  // back to a default floor and writes thirty-seconds against an all-sixteenths hook,
  // 60% of which `toGrid` then throws away. Its own guards already know better.
  const ctx: Context = {
    key: harmony.key, harmony: harmony.events, meter, weights: weightsFor(meter),
    instrument: PALETTES[genome.palette].melody,
  };
  const grid = beatTicks(meter) / 4;
  const out: Note[] = [];
  form.sections.forEach((s, i) => {
    const id = plan?.[s.label] ?? 'as-written';
    const slice = sliceAt(source, s.start, s.length);
    const treated = id === 'as-written'
      ? slice
      : toGrid(treatmentById(id).apply(slice, ctx, makeRng(genome.melody.seed + i * 7919)), grid);
    // A treatment may shorten its material — `double-time` halves it — and the section
    // it belongs to is fixed; tiling is what reconciles them.
    const filled = tileTo(treated, s.length);
    for (const n of filled.notes) {
      out.push({ ...n, start: tick(n.start + s.start), duration: tick(Math.min(n.duration, source.length - (n.start + s.start))) });
    }
  });
  return motif(out, source.length);
}

/**
 * Sections whose treatment has stopped sounding like the hook.
 *
 * The critic cannot catch this: it compares the written melody against the source it
 * was given, and under a variation that source is already the varied one, so the two
 * agree by construction. This is the check that the varied source is still kin to what
 * the hook wrote — the boundary that separates a variation from a second tune.
 *
 * Contour similarity is z-normalised and therefore octave-invariant, which is what you
 * want here: `octave-up` relocates every note and is unmistakably the same theme.
 */
export function variationProblems(source: Motif, varied: Motif, form: Form): string[] {
  const out: string[] = [];
  for (const s of form.sections) {
    const before = sliceAt(source, s.start, s.length);
    const raw = sliceAt(varied, s.start, s.length);
    if (!before.notes.length || !raw.notes.length) {
      if (before.notes.length !== raw.notes.length) out.push(`${s.label}: the treatment emptied the section`);
      continue;
    }
    if (kinship(raw, before) < CONTOUR_FLOOR) {
      out.push(`${s.label}: no longer recognisable as the hook`);
    }
  }
  return out;
}

/**
 * How far a section has travelled from what the hook wrote there, 0–1 — the share of
 * this section's notes that are not where the hook put them. The Vary stage shows it
 * per section so "different enough to notice" is something you can see before you play
 * it, rather than a claim in a blurb. Register counts: an octave lift moves everything.
 */
export function driftAt(source: Motif, varied: Motif, s: { start: Tick; length: Tick }): number {
  const a = sliceAt(source, s.start, s.length);
  const b = sliceAt(varied, s.start, s.length);
  if (!a.notes.length && !b.notes.length) return 0;
  const key = (m: Motif): Set<string> => new Set(m.notes.map((n) => `${n.start}:${n.pitch}`));
  const ka = key(a);
  const kb = key(b);
  let shared = 0;
  for (const k of ka) if (kb.has(k)) shared++;
  const union = ka.size + kb.size - shared;
  return union === 0 ? 0 : 1 - shared / union;
}
