import type { Genome, Instrument, Motif, Note, Rng } from '../../core/index.js';
import { OBOE, beatTicks, chordPCs, fitToRange, motif, tick } from '../../core/index.js';
import { chordAt, pitchAt, placePC, type GenContext } from '../context.js';

/**
 * Winds — one heuristic beats everything else: complementary rhythm (spec §7.4).
 * When the melody moves, winds sustain; when it rests or holds, winds move. We
 * detect beats with no melodic onset and put activity there, taking the register
 * from the melody displaced up an octave. Almost embarrassingly effective.
 *
 * Takes the GENERATED melody (DAG §8.3), not the source — winds answer what was written.
 */
export function generateWinds(
  g: GenContext, melody: Motif, params: Genome['winds'], rng: Rng, inst: Instrument = OBOE,
): Motif {
  const beat = beatTicks(g.meter);
  const centre = 74; // ~D5, oboe/clarinet tessitura
  const notes: Note[] = [];

  for (let t = 0; t + beat <= g.harmony.length; t += beat) {
    const melodyMovesHere = melody.notes.some((n) => n.start >= t && n.start < t + beat);
    if (melodyMovesHere) continue;          // melody active → winds sustain (rest)
    if (!rng.bool(params.activity)) continue; // fill gaps only as eagerly as `activity`

    const chord = chordAt(g.harmony, tick(t)).chord;
    const pcs = chordPCs(chord);
    const pcValue = pcs[1] ?? pcs[0] ?? chord.root; // prefer the 3rd for colour
    const target = Math.max(centre, pitchAt(melody, tick(t), centre) + 12);
    notes.push({ start: tick(t), duration: tick(beat), pitch: placePC(target, pcValue), velocity: 74 });
  }

  // Fit to the palette's ACTUAL instrument — fitting to a fixed oboe range and then
  // rendering through a pulse channel is how notes end up outside the voice's range.
  const fitted = notes.map((n) => ({ ...n, pitch: fitToRange(n.pitch, inst) }));
  return motif(fitted, g.harmony.length);
}
