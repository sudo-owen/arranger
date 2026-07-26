import type { Motif } from '../core/index.js';
import { PPQ } from '../core/index.js';

/**
 * Step-contour similarity (Müllensiefen; spec §7.5). Sample sounding pitch at N
 * equal time points, z-normalise, Pearson correlate. Sample-and-hold means adding
 * passing tones barely moves the curve — which is the whole point: ornamentation
 * must not tank the score. This is the ONE aesthetic criterion the critic hard-rejects
 * on (< 0.5 → different tune wearing the same chords). Target band 0.6–0.8.
 */
/**
 * Sample times ascend and notes are sorted, so one cursor walks both. Restarting the
 * note scan per sample made this quadratic — and since the sample count now follows
 * length, both factors grew together: at 64 bars it was 453µs, 91% of the entire
 * critic pass and 29% of `arrange()`.
 */
export function samplePitch(m: Motif, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  const L = Math.max(1, m.length);
  const notes = m.notes;
  let pitch: number = notes[0]?.pitch ?? 60;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = Math.floor((i * L) / n);
    while (j < notes.length && notes[j]!.start <= t) pitch = notes[j++]!.pitch;
    out[i] = pitch;
  }
  return out;
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

export function cosine(xs: readonly number[], ys: readonly number[]): number {
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

/**
 * Sample density has to follow LENGTH, not sit at a constant.
 *
 * A fixed 32 points is two samples per bar over 16 bars — coarse but workable — and one
 * sample every two bars over 64, which is below the rate the melody moves. Past that
 * point the score measures aliasing rather than shape, and long tracks got rejected for
 * "sounding different" when the curve was simply undersampled. Eighth-note resolution
 * keeps ornaments invisible (they are sixteenths) and structure visible at any length.
 */
const sampleCount = (lengthTicks: number): number => Math.max(32, Math.round(lengthTicks / (PPQ / 2)));

export function contourSimilarity(a: Motif, b: Motif): number {
  const n = sampleCount(Math.max(a.length, b.length));
  return cosine(zNorm(samplePitch(a, n)), zNorm(samplePitch(b, n)));
}

export const CONTOUR_FLOOR = 0.5;
export function passesContourFloor(candidate: Motif, source: Motif): boolean {
  return contourSimilarity(candidate, source) >= CONTOUR_FLOOR;
}
