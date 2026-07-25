import type { Key, Mode, Motif } from '../core/index.js';
import { pc } from '../core/index.js';

/**
 * Krumhansl–Schmuckler key finding (spec §7.1). Build a duration-weighted
 * pitch-class histogram, correlate it against all 24 rotated tonal profiles, take
 * the argmax. Robust to ornamentation because it's duration-weighted, not onset-count.
 */
const MODES: readonly Mode[] = ['major', 'minor'];

export const KS_MAJOR: readonly number[] = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
export const KS_MINOR: readonly number[] = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

export function pitchClassHistogram(m: Motif): number[] {
  const h = new Array<number>(12).fill(0);
  for (const n of m.notes) {
    const idx = pc(n.pitch);
    h[idx] = (h[idx] ?? 0) + n.duration;
  }
  return h;
}

export interface KeyEstimate {
  key: Key;
  correlation: number;
}

export function detectKeyRanked(m: Motif): KeyEstimate[] {
  const hist = pitchClassHistogram(m);
  const out: KeyEstimate[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of MODES) {
      const profile = mode === 'major' ? KS_MAJOR : KS_MINOR;
      const rotated = profile.map((_, i) => profile[(i - tonic + 12) % 12] ?? 0);
      out.push({ key: { tonic: pc(tonic), mode }, correlation: pearson(hist, rotated) });
    }
  }
  return out.sort((a, b) => b.correlation - a.correlation);
}

export function detectKey(m: Motif): Key {
  const first = detectKeyRanked(m)[0];
  return first?.key ?? { tonic: pc(0), mode: 'major' };
}

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i] ?? 0;
    my += ys[i] ?? 0;
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = (xs[i] ?? 0) - mx;
    const b = (ys[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}
