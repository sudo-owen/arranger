import type { Chord, Key, PC } from '../core/index.js';
import { pc } from '../core/index.js';

/** Diatonic scale-degree function of a chord root within a key (0 = tonic). */
export type Numeral = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII' | 'other';

const DEGREE_TO_NUMERAL: readonly Numeral[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const MAJOR_STEPS: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

export function numeralOf(chord: Chord, key: Key): Numeral {
  const rel = pc(chord.root - key.tonic);
  const steps = key.mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
  const deg = steps.findIndex((s) => s === rel);
  return deg === -1 ? 'other' : (DEGREE_TO_NUMERAL[deg] ?? 'other');
}

/** Pitch class of a scale degree above the tonic. */
export function degreePC(key: Key, degreeIndex: number): PC {
  const steps = key.mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
  const off = steps[((degreeIndex % 7) + 7) % 7] ?? 0;
  return pc(key.tonic + off);
}
