import type { Midi, PC } from './brand.js';
import { midi, pc } from './brand.js';
import type { Chord, Key, Mode, Quality } from './types.js';

const MAJOR_STEPS: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS: readonly number[] = [0, 2, 3, 5, 7, 8, 10]; // natural minor

export function scaleSteps(mode: Mode): readonly number[] {
  return mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
}

const CHORD_INTERVALS: Record<Quality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  min7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
};

export function chordPCs(chord: Chord): readonly PC[] {
  return CHORD_INTERVALS[chord.quality].map((i) => pc(chord.root + i));
}

export function isChordTone(pitch: Midi, chord: Chord): boolean {
  const target = pc(pitch);
  return chordPCs(chord).some((p) => p === target);
}

/**
 * Chromatic transposition — plain semitone add. No range clamp: MIDI validity is
 * a render-time concern (spec §8.5), and clamping here would break the algebraic
 * laws in §6.4 (reversibility).
 */
export function transposeChromatic(pitch: Midi, semitones: number): Midi {
  return midi(pitch + semitones);
}

/**
 * Absolute diatonic degree of a pitch within a key (7 degrees per octave). Off-scale
 * pitches snap to the nearest degree. This is the coordinate system diatonic
 * operators work in.
 */
export function toDiatonicDegree(pitch: Midi, key: Key): number {
  const steps = scaleSteps(key.mode);
  const rel = mod12(pc(pitch) - key.tonic);
  const octaves = Math.floor((pitch - key.tonic) / 12);
  return octaves * 7 + nearestDegreeIndex(rel, steps);
}

export function fromDiatonicDegree(absDegree: number, key: Key): Midi {
  const steps = scaleSteps(key.mode);
  const oct = Math.floor(absDegree / 7);
  const off = steps[mod(absDegree, 7)];
  if (off === undefined) throw new Error('scale index out of range');
  return midi(key.tonic + oct * 12 + off);
}

export function transposeDiatonic(pitch: Midi, key: Key, steps: number): Midi {
  return fromDiatonicDegree(toDiatonicDegree(pitch, key) + steps, key);
}

export function nearestChordTone(pitch: Midi, chord: Chord): Midi {
  const targets = chordPCs(chord);
  const base = Math.floor(pitch / 12) * 12;
  let best: number = pitch;
  let bestDist = Infinity;
  for (const t of targets) {
    for (const oct of [base - 12, base, base + 12]) {
      const d = Math.abs(oct + t - pitch);
      if (d < bestDist) {
        bestDist = d;
        best = oct + t;
      }
    }
  }
  return midi(best);
}

function nearestDegreeIndex(rel: number, steps: readonly number[]): number {
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s === undefined) continue;
    const d = Math.abs(s - rel);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const mod12 = (a: number): number => mod(a, 12);
