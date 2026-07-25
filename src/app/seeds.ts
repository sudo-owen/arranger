import { PPQ, fromDiatonicDegree, makeRng, motif, pc, tick, toDiatonicDegree } from '../core/index.js';
import type { Key, Mode, Motif, Note } from '../core/index.js';

export type SeedContour = 'balanced' | 'rising' | 'falling' | 'arch';
export type SeedActivity = 'sparse' | 'medium' | 'busy';
export type SeedRefinement = 'higher' | 'lower' | 'simplify' | 'densify' | 'smooth' | 'vary';
export interface SeedConstraints {
  tonic: number;
  mode: Mode;
  bars: number;
  contour: SeedContour;
  activity: SeedActivity;
}
export interface SeedBuilderOptions extends SeedConstraints {
  seed: number;
}

/** Build a short diatonic melody from user-selected structural constraints. */
export function generateSeedTune(options: SeedBuilderOptions): { motif: Motif; key: Key } {
  const key: Key = { tonic: pc(options.tonic), mode: options.mode };
  const rng = makeRng(options.seed);
  const slots = Math.max(8, options.bars * 8); // eighth-note grid
  const probability = options.activity === 'sparse' ? 0.42 : options.activity === 'busy' ? 0.86 : 0.64;
  const notes: Note[] = [];
  let degree = 35; // around middle C, expressed in absolute scale degrees

  for (let slot = 0; slot < slots; slot++) {
    const mustPlay = slot === 0 || slot % 8 === 0;
    if (!mustPlay && !rng.bool(probability)) continue;
    const progress = slot / Math.max(1, slots - 1);
    const direction = contourDirection(options.contour, progress);
    const roll = rng.next();
    let step = roll < 0.18 ? -2 : roll < 0.45 ? -1 : roll < 0.62 ? 0 : roll < 0.88 ? 1 : 2;
    if (direction !== 0 && rng.bool(0.68)) step = Math.abs(step || 1) * direction;
    degree += step;
    degree = Math.max(30, Math.min(41, degree));
    const nextSlot = Math.min(slots, slot + (options.activity === 'sparse' && rng.bool(0.5) ? 2 : 1));
    notes.push({
      start: tick(slot * PPQ / 2),
      duration: tick((nextSlot - slot) * PPQ / 2),
      pitch: fromDiatonicDegree(degree, key),
      velocity: 88 + rng.int(20),
    });
  }
  return { motif: motif(notes, tick(options.bars * 4 * PPQ)), key };
}

function contourDirection(contour: SeedContour, progress: number): -1 | 0 | 1 {
  if (contour === 'rising') return 1;
  if (contour === 'falling') return -1;
  if (contour === 'arch') return progress < 0.5 ? 1 : -1;
  return 0;
}

export function refineSeedTune(source: Motif, key: Key, action: Exclude<SeedRefinement, 'vary'>): Motif {
  if (action === 'higher' || action === 'lower') {
    const step = action === 'higher' ? 1 : -1;
    return motif(source.notes.map((note) => ({
      ...note,
      pitch: fromDiatonicDegree(toDiatonicDegree(note.pitch, key) + step, key),
    })), source.length);
  }
  if (action === 'simplify') {
    const notes = source.notes.filter((note, i) => i === 0 || note.start % PPQ === 0 || i % 2 === 0);
    return motif(notes, source.length);
  }
  if (action === 'densify') {
    const notes: Note[] = [...source.notes];
    for (let i = 0; i < source.notes.length - 1; i++) {
      const a = source.notes[i];
      const b = source.notes[i + 1];
      if (!a || !b || b.start - a.start < PPQ) continue;
      const start = tick(a.start + Math.floor((b.start - a.start) / 2));
      const aDegree = toDiatonicDegree(a.pitch, key);
      const bDegree = toDiatonicDegree(b.pitch, key);
      notes.push({
        start,
        duration: tick(Math.min(PPQ / 2, b.start - start)),
        pitch: fromDiatonicDegree(Math.round((aDegree + bDegree) / 2), key),
        velocity: Math.round((a.velocity + b.velocity) / 2),
      });
    }
    return motif(notes, source.length);
  }

  let previous: number | null = null;
  const notes = source.notes.map((note) => {
    const degree = toDiatonicDegree(note.pitch, key);
    const smoothed = previous === null ? degree : Math.max(previous - 2, Math.min(previous + 2, degree));
    previous = smoothed;
    return { ...note, pitch: fromDiatonicDegree(smoothed, key) };
  });
  return motif(notes, source.length);
}

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
