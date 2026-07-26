import type { Genome, Instrument, Motif, Note, Rng } from '../../core/index.js';
import { TRI_BASS, beatInBar, beatTicks, chordPCs, fitToRange, motif, pc, tick } from '../../core/index.js';
import { chordAt, placePC, type GenContext } from '../context.js';

/**
 * Bass line — nearly pure rules (spec §7.4). Root on the downbeat always; a chord
 * tone mid-bar; walking approach tones on the offbeats scaled by `walkiness`; a
 * step approach into the next root before a chord change. This is the track that
 * proves the thesis at M2 — "the first moment it's music."
 */
export function generateBass(
  g: GenContext, params: Genome['bass'], rng: Rng, inst: Instrument = TRI_BASS,
): Motif {
  const beat = beatTicks(g.meter);
  const centre = 40 + Math.round(params.register * 12); // ~E2, biased by register
  const notes: Note[] = [];

  for (let t = 0; t + beat <= g.harmony.length; t += beat) {
    const chord = chordAt(g.harmony, tick(t)).chord;
    const bib = beatInBar(t, g.meter);
    const nextChangesHere = chordAt(g.harmony, tick(t + beat)).chord.root !== chord.root;

    const pcs = chordPCs(chord);
    const root = pcs[0] ?? chord.root;
    const third = pcs[1] ?? root;
    const fifth = pcs[2] ?? root;

    let pcValue: number | null;
    if (nextChangesHere && params.walkiness > 0.3) {
      const nextRoot = chordAt(g.harmony, tick(t + beat)).chord.root;
      pcValue = pc(nextRoot - 1); // chromatic approach from below
    } else if (bib === 0) {
      pcValue = root;
    } else if (bib === 2) {
      pcValue = rng.bool() ? third : fifth;
    } else {
      pcValue = rng.bool(params.walkiness) ? rng.pick([root, third, fifth]) : null;
    }

    if (pcValue !== null) {
      // Fold into the instrument's range. `register` can push the centre below any real
      // bass voice's floor; winds and brass have always done this, bass never did.
      const pitch = fitToRange(placePC(centre, pcValue), inst);
      notes.push({ start: tick(t), duration: tick(beat), pitch, velocity: 96 });
    }
  }
  return motif(notes, g.harmony.length);
}
