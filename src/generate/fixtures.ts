import type { Chord, Genome, Harmony, Meter, Motif, Note, Quality } from '../core/index.js';
import { PPQ, midi, motif, pc, tick } from '../core/index.js';
import { wholeForm, type GenContext } from './context.js';

const BAR = PPQ * 4;
const ch = (root: number, quality: Quality): Chord => ({ root: pc(root), quality });

export function fixtureHarmony(): Harmony {
  const chords = [ch(0, 'maj'), ch(5, 'maj'), ch(7, 'maj'), ch(0, 'maj')]; // I IV V I in C
  const events = chords.map((chord, i) => ({ start: tick(i * BAR), duration: tick(BAR), chord }));
  return { key: { tonic: pc(0), mode: 'major' }, events, length: tick(chords.length * BAR) };
}

export function fixtureSource(): Motif {
  // Per bar: a half note on beat 1 (holds through beat 2), a quarter on beat 3,
  // and a rest on beat 4 — so the melody breathes and winds have gaps to fill.
  const bars: [number, number][] = [[60, 67], [69, 65], [71, 74], [72, 64]]; // I(C) IV(F) V(G) I(C)
  const q = PPQ;
  const notes: Note[] = [];
  bars.forEach(([high, low], b) => {
    notes.push({ start: tick(b * BAR), duration: tick(2 * q), pitch: midi(high), velocity: 90 });
    notes.push({ start: tick(b * BAR + 2 * q), duration: tick(q), pitch: midi(low), velocity: 90 });
  });
  return motif(notes);
}

export function fixtureContext(): GenContext {
  const harmony = fixtureHarmony();
  const meter: Meter = { num: 4, den: 4 };
  return { harmony, form: wholeForm(harmony), meter, source: fixtureSource() };
}

export function fixtureGenome(): Genome {
  return {
    version: 1,
    palette: 'chip-orchestral',
    skeleton: { seed: 1, temperature: 0.3, template: 'sentence', bars: 4 },
    melody: { seed: 11, ornament: 0.5, radius: 0.3 },
    bass: { seed: 22, walkiness: 0.6, register: 0 },
    drums: { seed: 33, fillDensity: 0.5, swing: 0.3 },
    winds: { seed: 44, activity: 0.6, ornament: 0.2 },
    brass: { seed: 55, voicing: 'drop2', density: 0.7 },
  };
}
