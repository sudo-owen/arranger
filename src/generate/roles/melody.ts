import type { Context, Genome, Instrument, Motif, Note, Rng } from '../../core/index.js';
import { LEAD, beatTicks, fitToRange, midi, nearestChordTone, motif, ornament, tick, weightsFor } from '../../core/index.js';
import { contourSimilarity, CONTOUR_FLOOR } from '../../theory/index.js';
import { chordAt, type GenContext } from '../context.js';

/**
 * Melody over fixed harmony (spec §7.4). The skeleton follows the SOURCE's rhythm —
 * a chord tone at each source onset, with the source's own note lengths — so the
 * result keeps the tune's phrasing (its holds and rests), not just its pitches. That
 * rhythmic fidelity is what lets winds and brass answer it (complementary rhythm,
 * §7.4) and keeps the contour floor (§3.7) satisfied by construction. `ornament`
 * then adds surface, and we re-check: if it ever drops similarity below 0.5, we fall
 * back to the bare skeleton.
 *
 * Chaining more operators for wider variation is what `generate/variation.ts` does, a
 * whole recurrence at a time rather than a note at a time.
 */
/**
 * Shift the whole line by octaves until it sits inside the voice, rather than folding
 * notes individually — a constant offset leaves the contour bit-identical, where
 * per-note folding would invent leaps and fail the very floor it is protecting.
 *
 * Melody was the one role that never did this. A descending `answer` over a one-bar
 * cell walks below the lead's floor, and since the whole candidate set shares a melody
 * seed, that sank every bed at once: about one Generate in forty returned nothing.
 */
function fitLineToRange(notes: readonly Note[], inst: Instrument): Note[] {
  if (!notes.length) return [...notes];
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); }
  let shift = 0;
  while (lo + shift < inst.low && hi + shift + 12 <= inst.high) shift += 12;
  while (hi + shift > inst.high && lo + shift - 12 >= inst.low) shift -= 12;
  const out = notes.map((n) => ({ ...n, pitch: midi(n.pitch + shift) }));
  // A line wider than the instrument cannot be shifted into it; clamp the stragglers.
  return out.map((n) => ({ ...n, pitch: fitToRange(n.pitch, inst) }));
}

export function generateMelody(
  g: GenContext, params: Genome['melody'], rng: Rng, inst: Instrument = LEAD,
): Motif {
  const beat = beatTicks(g.meter);
  // Snap to SIXTEENTHS, not to the beat.
  //
  // Beat-snapping was written for quarter-note source melodies, where it is a no-op.
  // Against a battle hook it is destructive: a bar of eighths or sixteenths collapses
  // onto four onsets, `seen` discards the rest, and the result fails its own contour
  // floor — the generator throwing away the tune it was asked to preserve. The docstring
  // above always claimed the source's rhythm was kept; now it actually is.
  const grid = Math.max(1, Math.floor(beat / 4));
  const skeleton: Note[] = [];
  const seen = new Set<number>();

  for (const sn of g.source.notes) {
    const t = Math.round(sn.start / grid) * grid;
    if (t >= g.harmony.length || seen.has(t)) continue;
    seen.add(t);
    const chord = chordAt(g.harmony, tick(t)).chord;
    const pitch = nearestChordTone(sn.pitch, chord); // consonant + tracks source contour
    const rawDur = Math.max(grid, Math.round(sn.duration / grid) * grid); // keep the source's length
    skeleton.push({ start: tick(t), duration: tick(Math.min(rawDur, g.harmony.length - t)), pitch, velocity: 92 });
  }

  const skel = motif(fitLineToRange(skeleton, inst), g.harmony.length);
  // Naming the instrument is what stops `ornament` writing figures this voice cannot
  // play — `Context.instrument` existed for exactly this and had never been passed.
  const ctx: Context = { key: g.harmony.key, harmony: g.harmony.events, meter: g.meter, weights: weightsFor(g.meter), instrument: inst };
  const decorated = ornament(skel, ctx, rng, params.ornament, ['passing', 'neighbor', 'anticipation']);

  return contourSimilarity(decorated, g.source) >= CONTOUR_FLOOR ? decorated : skel;
}
