import { fromDiatonicDegree, motif, tick, toDiatonicDegree } from '../core/index.js';
import type { Key, Motif } from '../core/index.js';

/**
 * Double a phrase and make the second half answer the first. The copied material
 * keeps its rhythm and contour; its final third turns toward a nearby diatonic
 * pitch so repeated extension sounds developed rather than simply looped.
 */
export function extendTune(source: Motif, key: Key): Motif {
  const answerStart = source.length;
  const turnAt = Math.max(0, Math.floor(source.notes.length * 2 / 3));
  const answer = source.notes.map((note, i) => {
    const step = i < turnAt ? 0 : (i === source.notes.length - 1 ? -2 : 1);
    const degree = toDiatonicDegree(note.pitch, key);
    return {
      ...note,
      start: tick(note.start + answerStart),
      pitch: step === 0 ? note.pitch : fromDiatonicDegree(degree + step, key),
      velocity: Math.max(54, note.velocity - 5),
    };
  });
  return motif([...source.notes, ...answer], tick(source.length * 2));
}
