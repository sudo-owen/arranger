import type { Meter, Mood, Note, Role, Tick, Track } from '../core/index.js';
import { barTicks, clamp, normWeightAt, tick, weightsFor } from '../core/index.js';
import type { Form } from '../core/index.js';
import { formTicks, intensityAt } from './form.js';

/**
 * Phrase dynamics — the one pass that makes the output sound played rather than entered.
 *
 * Every generator writes a constant velocity for its role (melody 92, bass 96, brass 88,
 * winds 74/62, tenor 66/82/84), which is a mix balance rather than a performance: nothing
 * swells, nothing accents, nothing settles. This shapes all of it in one place, after the
 * roles are written, so the generators stay about notes and the shaping is uniform.
 *
 * Three offsets, summed:
 *
 * - **Metric accent** — strong beats louder than weak ones, from the §7.1 weight grid.
 * - **Section level** — where the section sits in the arc, from its composed mood.
 * - **Lead-in** — a ramp across the end of each section into the level of the next.
 *
 * ADDITIVE rather than multiplicative, which is the one non-obvious choice here. Scaling
 * would widen the gap between roles as the track gets louder — a climax would not just be
 * louder, it would be differently balanced, and the winds would fall out from under the
 * brass exactly when the arrangement is at its thickest. Adding a shared offset moves the
 * whole ensemble and leaves the authored balance intact.
 */

/**
 * The window where velocity still does anything. `velocityGain` clamps its multiplier to
 * 0.25–1.3 around a nominal 100, so shaping below ~25 or above ~130 is computed, written
 * into the MIDI file, and then inaudible in both renderers.
 */
const FLOOR = 32;
const CEIL = 124;

const ACCENT = 9;     // ± on the metric grid
const LEVEL = 11;     // ± around neutral, by section mood
const RAMP_BARS = 2;  // how long a lead-in takes to arrive

/**
 * Drums are shaped by the lead-in ONLY.
 *
 * They opt out of the accent because they are what the metre is made of — accenting a
 * backbeat snare by the grid would fight the pattern that defines the grid. They opt out
 * of the level because `generateDrums` already scales every hit by section intensity
 * (`88 + intensity * 24` on the kick), so adding it again counts it twice and the climax
 * clips while the intro disappears.
 */
const shaped = (role: Role): boolean => role !== 'drums';

/**
 * One row per section, resolved once.
 *
 * Level and lead-in are constant within a section and there are at most six of them, but
 * they were being re-derived per note — each call a linear scan for the section plus two
 * throwaway `Mood` objects from `composeMood`. On a 90-second track that is thousands of
 * scans and allocations to produce six distinct numbers.
 *
 * `ramp` is the lead-in window at the section's end; `delta` is how far the level travels
 * across it. The final section ramps toward `form.loopStart` — with a head that plays
 * once, aiming the crescendo at the intro would target a level the loop never returns to.
 */
interface Shaping { from: number; ramp: number; level: number; delta: number }

function shapingOf(form: Form, meter: Meter, mood: Mood): Shaping[] {
  const bar = barTicks(meter);
  const total = formTicks(form);
  const levelAt = (t: number): number => (intensityAt(form, tick(t), mood) - 0.5) * 2 * LEVEL;
  return form.sections.map((s) => {
    const end = s.start + s.length;
    const ramp = Math.min(RAMP_BARS * bar, s.length / 2);
    const level = levelAt(s.start);
    return {
      from: end - ramp,
      ramp,
      level,
      delta: levelAt(end >= total ? form.loopStart : end) - level,
    };
  });
}

export function shapeDynamics(tracks: readonly Track[], form: Form, meter: Meter, mood: Mood): Track[] {
  const weights = weightsFor(meter);
  const shaping = shapingOf(form, meter, mood);
  const last = shaping.at(-1);
  const at = (t: Tick): Shaping | undefined => shaping.find((x) => t < x.from + x.ramp) ?? last;

  return tracks.map((track) => {
    const on = shaped(track.role);
    const notes: Note[] = track.motif.notes.map((n) => {
      const s = at(n.start);
      const accent = on ? (normWeightAt(n.start, meter, weights) * 2 - 1) * ACCENT : 0;
      const level = on && s ? s.level : 0;
      const leadIn = !s || n.start < s.from || s.ramp <= 0 ? 0 : s.delta * ((n.start - s.from) / s.ramp);
      return { ...n, velocity: Math.round(clamp(n.velocity + accent + level + leadIn, FLOOR, CEIL)) };
    });
    return { ...track, motif: { ...track.motif, notes } };
  });
}
