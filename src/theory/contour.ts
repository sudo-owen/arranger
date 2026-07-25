import type { Motif } from '../core/index.js';

/**
 * Step-contour similarity (Müllensiefen; spec §7.5). Sample sounding pitch at N
 * equal time points, z-normalise, Pearson correlate. Sample-and-hold means adding
 * passing tones barely moves the curve — which is the whole point: ornamentation
 * must not tank the score. This is the ONE aesthetic criterion the critic hard-rejects
 * on (< 0.5 → different tune wearing the same chords). Target band 0.6–0.8.
 */
export function samplePitch(m: Motif, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  const L = Math.max(1, m.length);
  const notes = m.notes;
  const firstPitch: number = notes[0]?.pitch ?? 60;
  for (let i = 0; i < n; i++) {
    const t = Math.floor((i * L) / n);
    out[i] = soundingPitchAt(notes, t, firstPitch);
  }
  return out;
}

function soundingPitchAt(notes: Motif['notes'], t: number, fallback: number): number {
  // Most recent note whose onset is at or before t (sample-and-hold).
  let p = fallback;
  for (const nt of notes) {
    if (nt.start <= t) p = nt.pitch;
    else break; // notes are sorted by start
  }
  return p;
}

export function zNorm(xs: readonly number[]): number[] {
  const n = xs.length;
  if (n === 0) return [];
  let mean = 0;
  for (const x of xs) mean += x;
  mean /= n;
  let variance = 0;
  for (const x of xs) variance += (x - mean) * (x - mean);
  const sd = Math.sqrt(variance / n);
  if (sd === 0) return xs.map(() => 0);
  return xs.map((x) => (x - mean) / sd);
}

export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return 0;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] ?? 0;
    const b = ys[i] ?? 0;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

export function contourSimilarity(a: Motif, b: Motif, n = 32): number {
  return pearson(zNorm(samplePitch(a, n)), zNorm(samplePitch(b, n)));
}

/** The spec's hard floor (§3.7, §7.5). */
export const CONTOUR_FLOOR = 0.5;
export function passesContourFloor(candidate: Motif, source: Motif): boolean {
  return contourSimilarity(candidate, source) >= CONTOUR_FLOOR;
}
