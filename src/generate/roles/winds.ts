import type { Genome, Instrument, Midi, Motif, Note, Rng } from '../../core/index.js';
import {
  OBOE, barTicks, beatTicks, chordPCs, fitToRange, fromDiatonicDegree, midi, motif, sliceAt,
  tick, toDiatonicDegree,
} from '../../core/index.js';
import { chordAt, pitchAt, placePC, type GenContext } from '../context.js';
import { intensityAt } from '../form.js';

/**
 * Winds — complementary rhythm (spec §7.4), both halves of it. Where the melody leaves
 * room the winds move; where it does not, they sustain underneath it.
 *
 * "Busy" is measured as SOUNDING COVERAGE, not as onsets. A battle hook averages three
 * onsets a beat and covers 80–100% of every one, so an onset test marks every beat busy
 * and the generator writes nothing at all. Coverage splits the track into windows the
 * melody occupies and windows it leaves open. A window is one or the other, never both,
 * so the line stays monophonic by construction — which is what the critic holds a solo
 * wind to.
 *
 * Takes the GENERATED melody (DAG §8.3), not the source — winds answer what was written.
 */
const OPEN_ENOUGH = 0.6; // a beat less than 60% covered by melody has room to answer

const CENTRE = 74; // ~D5, oboe/clarinet tessitura

/**
 * Ceiling for the answer branch below.
 *
 * An answer wants to sit above the lead so it reads as a reply rather than a doubling,
 * but "an octave above wherever the melody left off" is unbounded, and a battle hook
 * already lives at 71–79. That put wind answers at 83–85 — the top of WIND_SECTION's
 * range, where a unison line stops reading as a line and starts reading as air.
 */
const ANSWER_TOP = 81; // A5

/**
 * A counter-line over one window, derived from the hook rather than invented.
 *
 * Inverted around its own centre so it moves against the tune instead of doubling it,
 * and thinned to eighths first: the source is sixteenths, and a wind section asked to
 * tongue a full inverted hook is the articulation rejection the critic exists to catch.
 * Each note runs to the next onset, so the line stays monophonic by construction.
 */
function counterLine(g: GenContext, from: number, span: number, rng: Rng): Note[] {
  const grid = beatTicks(g.meter) / 2;
  const slice = sliceAt(g.source, from, span);
  const onsets = [...new Set(slice.notes.map((n) => Math.round(n.start / grid) * grid))].sort((a, b) => a - b);
  if (onsets.length < 2) return [];
  const heard = onsets.map((t) => slice.notes.find((n) => Math.round(n.start / grid) * grid === t)!);
  const axis = Math.round(heard.reduce((sum, n) => sum + n.pitch, 0) / heard.length);
  return heard.map((n, i) => {
    const to = (onsets[i + 1] ?? span) - onsets[i]!;
    const flipped = fromDiatonicDegree(
      2 * toDiatonicDegree(midi(axis), g.harmony.key) - toDiatonicDegree(n.pitch, g.harmony.key),
      g.harmony.key,
    );
    return {
      start: tick(from + onsets[i]!), duration: tick(to),
      pitch: placePC(CENTRE, flipped % 12), velocity: 70 + rng.int(8),
    };
  });
}

export function generateWinds(
  g: GenContext, melody: Motif, params: Genome['winds'], rng: Rng, inst: Instrument = OBOE,
): Motif {
  const beat = beatTicks(g.meter);
  const window = barTicks(g.meter) / 2;
  const notes: Note[] = [];

  // Melody ticks sounding in each beat, in one pass rather than a scan per beat.
  const covered = new Map<number, number>();
  for (const n of melody.notes) {
    const from = n.start;
    const to = n.start + n.duration;
    for (let b = Math.floor(from / beat); b <= Math.floor((to - 1) / beat); b++) {
      const overlap = Math.min(to, (b + 1) * beat) - Math.max(from, b * beat);
      if (overlap > 0) covered.set(b, (covered.get(b) ?? 0) + overlap);
    }
  }
  const isOpen = (t: number): boolean => (covered.get(Math.floor(t / beat)) ?? 0) / beat < OPEN_ENOUGH;

  const colourPC = (t: number): number => {
    const chord = chordAt(g.harmony, tick(t)).chord;
    const pcs = chordPCs(chord);
    return pcs[1] ?? pcs[0] ?? chord.root; // prefer the 3rd for colour
  };
  const colourAt = (t: number, near: number): Midi => placePC(near, colourPC(t));
  /**
   * The colour tone at or below `ceiling`, rather than at the nearest octave to it.
   *
   * `placePC` centres, so it reaches six semitones ABOVE whatever it is given — capping
   * the centre still let answers out at 85. A ceiling has to be placed under, not near.
   */
  const colourUnder = (t: number, ceiling: number): Midi => {
    const pcValue = colourPC(t);
    const p = Math.round((ceiling - pcValue) / 12) * 12 + pcValue;
    return midi(p > ceiling ? p - 12 : p);
  };

  for (let w = 0; w + window <= g.harmony.length; w += window) {
    // One presence for both branches. Giving the sustain branch its own constant made
    // `activity` mean two different things — 0 was silence in one and 45% in the other —
    // and left half the winds deaf to the form arc, identically dense in the intro and
    // the climax.
    const presence = params.activity * (0.35 + intensityAt(g.form, tick(w), g.mood) * 1.1);
    const open: number[] = [];
    for (let t = w; t < w + window; t += beat) if (isOpen(t)) open.push(t);

    if (open.length * beat === window && rng.bool(presence)) {
      // The melody has stepped back for the whole window — which is what a thinned
      // section is. This is the sub-melody: rather than punctuate the gap with a colour
      // tone, take the hook's own material for these bars and turn it upside down, so a
      // second voice carries the tune while the lead is away.
      notes.push(...counterLine(g, w, window, rng));
      continue;
    }
    if (open.length) {
      // The melody rests or holds here — answer it, above where it left off but under
      // the ceiling, so the reply stays a wind line rather than a whistle over the top.
      for (const t of open) {
        if (!rng.bool(presence)) continue;
        const lead = pitchAt(melody, tick(t), CENTRE);
        notes.push({
          start: tick(t), duration: tick(beat),
          pitch: colourUnder(t, Math.min(Math.max(CENTRE, lead + 12), ANSWER_TOP)), velocity: 74,
        });
      }
      continue;
    }
    // The melody owns this window — hold a chord tone under it, releasing a beat early
    // so the section is never asked for an unbroken line the whole track long.
    if (!rng.bool(presence)) continue;
    notes.push({
      start: tick(w), duration: tick(window - beat / 2),
      pitch: colourAt(w, pitchAt(melody, tick(w), CENTRE) - 5), velocity: 62,
    });
  }

  // Fit to the palette's ACTUAL instrument — fitting to a fixed oboe range and then
  // rendering through a pulse channel is how notes end up outside the voice's range.
  const fitted = notes.map((n) => ({ ...n, pitch: fitToRange(n.pitch, inst) }));
  return motif(fitted, g.harmony.length);
}
