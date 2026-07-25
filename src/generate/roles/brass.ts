import type { Context, Genome, Instrument, Midi, Motif, Note, Rng } from '../../core/index.js';
import { BRASS_SECTION, barTicks, beatTicks, chordPCs, fitToRange, isChordTone, midi, motif, tick, weightsFor } from '../../core/index.js';
import { isStructural, voice, type VoicingStyle } from '../../theory/index.js';
import { chordAt, placePC, type GenContext } from '../context.js';

/**
 * Brass — block harmonisation (spec §7.4). Four-way close / drop-2 under the melody
 * note; a non-chord-tone melody note gets a diminished passing stack; `stabs` locks
 * the rhythm to the kick with chord tones only. `density` chooses which hits sound.
 */
export function generateBrass(
  g: GenContext, melody: Motif, params: Genome['brass'], rng: Rng, inst: Instrument = BRASS_SECTION,
): Motif {
  const notes: Note[] = [];
  const stack = (start: number, dur: number, pitches: readonly Midi[], vel: number): void => {
    for (const p of pitches) {
      notes.push({ start: tick(start), duration: tick(dur), pitch: fitToRange(p, inst), velocity: vel });
    }
  };

  if (params.voicing === 'stabs') {
    const beat = beatTicks(g.meter);
    const bar = barTicks(g.meter);
    for (let t = 0; t + beat <= g.harmony.length; t += beat) {
      const bib = Math.floor((((t % bar) + bar) % bar) / beat);
      if (bib !== 0 && bib !== 2) continue; // kick-locked (beats 1 & 3)
      if (!rng.bool(params.density)) continue;
      const chord = chordAt(g.harmony, tick(t)).chord;
      const top = placePC(72, chordPCs(chord)[0] ?? chord.root);
      stack(t, Math.floor(beat / 2), voice(top, chord, 'close'), 100);
    }
    return motif(notes, g.harmony.length);
  }

  const style: VoicingStyle = params.voicing; // 'close' | 'drop2' | 'drop3'
  const ctx: Context = { key: g.harmony.key, harmony: g.harmony.events, meter: g.meter, weights: weightsFor(g.meter) };
  for (const n of melody.notes) {
    if (!isStructural(n, ctx)) continue;      // harmonise the structural skeleton, not passing tones
    if (!rng.bool(params.density)) continue;
    const chord = chordAt(g.harmony, n.start).chord;
    const pitches = isChordTone(n.pitch, chord)
      ? voice(n.pitch, chord, style)
      : [n.pitch, midi(n.pitch - 3), midi(n.pitch - 6), midi(n.pitch - 9)]; // diminished passing chord
    stack(n.start, n.duration, pitches, 88);
  }
  return motif(notes, g.harmony.length);
}
