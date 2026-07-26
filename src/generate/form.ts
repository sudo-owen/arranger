import type { Form, Meter, Mood, Section, SectionLabel, Tick } from '../core/index.js';
import { NEUTRAL_MOOD, barTicks, barsIn, composeMood, secPerTick, tick } from '../core/index.js';

/**
 * Growing a 16-bar bed into a track.
 *
 * Doubling — the only growth this had before — produces a longer loop, not a song: the
 * same material at the same intensity for ninety seconds. A section plan gives the
 * track an arc, and gives every later stage somewhere to hang variation.
 *
 * Two constraints shape every plan here:
 *
 * 1. **Bar counts are multiples of four.** Phrases are four bars and progressions are
 *    four chords, so a section that is not a multiple of four either cuts a phrase in
 *    half or lands the loop on the wrong chord.
 * 2. **The last bar must lead back to the first.** The game loops this forever, so the
 *    join is heard more often than any other bar in the track.
 */

const PHRASE_BARS = 4;

export interface FormShape {
  /** Doubles as the identity in `SongSpec`; a closed union, unlike a free-form id. */
  template: Form['template'];
  label: string;
  blurb: string;
  /** Section labels with relative weights; bars are allocated in whole phrases. */
  parts: readonly (readonly [SectionLabel, number])[];
}

/** Every section needs at least one phrase, so a six-part shape needs six of them. */
export const minBars = (shape: FormShape): number => shape.parts.length * PHRASE_BARS;

/** The shapes that fit in `bars` — a 30-second track cannot hold a six-section arc. */
export const shapesFor = (bars: number): FormShape[] =>
  FORM_SHAPES.filter((s) => minBars(s) <= bars);

/**
 * Section moods are ABSOLUTE positions in the mood square, composed with the track's
 * current mood at render time — so dragging the pad moves the whole arc up or down
 * rather than flattening it.
 */
const SECTION_MOOD: Readonly<Record<SectionLabel, Mood>> = {
  intro: { urgency: 0.25, fortune: 0.45 },
  A: { urgency: 0.5, fortune: 0.5 },
  "A'": { urgency: 0.62, fortune: 0.55 },
  B: { urgency: 0.4, fortune: 0.35 },
  'A"': { urgency: 0.85, fortune: 0.65 },
  tag: { urgency: 0.45, fortune: 0.5 },
};

export const FORM_SHAPES: readonly FormShape[] = [
  {
    template: 'arc', label: 'Arc',
    blurb: 'builds, breaks, then peaks — the standard battle shape',
    parts: [['intro', 1], ['A', 2], ["A'", 2], ['B', 2], ['A"', 2], ['tag', 1]],
  },
  {
    template: 'surge', label: 'Surge',
    blurb: 'straight in, one dip, long climax',
    parts: [['A', 2], ["A'", 2], ['B', 1], ['A"', 3], ['tag', 1]],
  },
  {
    template: 'relentless', label: 'Relentless',
    blurb: 'no breakdown — pressure the whole way',
    parts: [['intro', 1], ['A', 3], ["A'", 3], ['A"', 3]],
  },
];

export function barsForSeconds(seconds: number, bpm: number, meter: Meter): number {
  const barsPerSecond = 1 / (barTicks(meter) * secPerTick(bpm));
  return Math.max(PHRASE_BARS, Math.round((seconds * barsPerSecond) / PHRASE_BARS) * PHRASE_BARS);
}

export const secondsForBars = (bars: number, bpm: number, meter: Meter): number =>
  bars * barTicks(meter) * secPerTick(bpm);

/**
 * Split `totalBars` across weighted parts in whole phrases, by largest remainder.
 *
 * Every part is guaranteed one phrase up front, so the weights only divide what is
 * left over — which is what keeps the ordering honest at short lengths. Rounding each
 * weight independently and then pushing the drift onto the largest part inverted the
 * arc at 28 bars: with every part rounding to one phrase, the whole remainder landed
 * on `intro`, making it the longest section and the climax the shortest.
 */
function allocate(weights: readonly number[], totalBars: number): number[] {
  const phrases = Math.max(weights.length, Math.round(totalBars / PHRASE_BARS));
  const sum = weights.reduce((a, b) => a + b, 0);
  const spare = phrases - weights.length;
  const exact = weights.map((w) => (w / sum) * spare);
  const out = exact.map((x) => 1 + Math.floor(x));
  let left = phrases - out.reduce((a, b) => a + b, 0);
  for (const { i } of exact.map((x, i) => ({ i, frac: x % 1 })).sort((a, b) => b.frac - a.frac)) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out.map((p) => p * PHRASE_BARS);
}

export function planForm(shape: FormShape, totalBars: number, meter: Meter): Form {
  const bar = barTicks(meter);
  const bars = allocate(shape.parts.map(([, w]) => w), totalBars);
  const sections: Section[] = [];
  let at = 0;
  shape.parts.forEach(([label], i) => {
    const length = bars[i]! * bar;
    sections.push({ label, start: tick(at), length: tick(length), mood: SECTION_MOOD[label] });
    at += length;
  });
  return { sections, template: shape.template };
}

export const formTicks = (form: Form): number => formTicksOf(form);
export const formBars = (form: Form, meter: Meter): number => barsIn(formTicks(form), meter);

const formTicksOf = (form: Form): number =>
  form.sections.reduce((n, s) => n + s.length, 0);

export function sectionAt(form: Form, t: Tick): Section {
  const last = form.sections.at(-1);
  if (!last) throw new Error('sectionAt: empty form');
  return form.sections.find((s) => t < s.start + s.length) ?? last;
}

export const moodAt = (form: Form, t: Tick, global: Mood = NEUTRAL_MOOD): Mood =>
  composeMood(global, sectionAt(form, t).mood);

/**
 * 0–1 activity at `t`, which is what the role generators scale by.
 *
 * `GenContext` carries no mood, so a generator cannot pass one and this is always the
 * section's own urgency today. The pad still reaches the output — through
 * `deform(genome, mood)` upstream — but per-section mood and global mood are two
 * separate channels until Phase 5 threads mood into the context and lets sections
 * deform the genome directly.
 */
export const intensityAt = (form: Form, t: Tick): number => sectionAt(form, t).mood.urgency;
