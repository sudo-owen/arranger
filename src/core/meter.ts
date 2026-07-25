import type { Tick } from './brand.js';
import { PPQ } from './brand.js';
import type { Meter } from './types.js';

/**
 * Metric weight grid for 4/4 at 16th-note resolution (spec §7.1). This grid does
 * triple duty: NCT detection, the thin/ornament threshold, and HMM emission
 * weighting. Get it right once.
 */
export const WEIGHTS_4_4: readonly number[] = [
  4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0,
];

/**
 * Default weight grid for a meter. Falls back to a strong downbeat + medium beats
 * for meters we don't special-case (v1 focuses on 4/4; spec §7.1 says don't build
 * meter induction).
 */
export function weightsFor(meter: Meter): readonly number[] {
  if (meter.num === 4 && meter.den === 4) return WEIGHTS_4_4;
  const per = 4; // sixteenths per beat
  return Array.from({ length: meter.num * per }, (_, i) =>
    i === 0 ? 4 : i % per === 0 ? 2 : 0,
  );
}

const sixteenth = (): number => PPQ / 4;

/** Ticks per bar. */
export function barTicks(meter: Meter): number {
  return (meter.num * (PPQ * 4)) / meter.den;
}

/** Ticks per beat. */
export function beatTicks(meter: Meter): number {
  return (PPQ * 4) / meter.den;
}

/** Raw metric weight at a tick — indexes the grid by 16th-note position in the bar. */
export function weightAt(t: Tick, meter: Meter, weights: readonly number[]): number {
  const bar = barTicks(meter);
  const posInBar = ((t % bar) + bar) % bar;
  const w = weights[Math.floor(posInBar / sixteenth()) % weights.length];
  return w === undefined ? 0 : w;
}

/** Metric weight normalised to 0–1 relative to the grid maximum. */
export function normWeightAt(t: Tick, meter: Meter, weights: readonly number[]): number {
  let max = 0;
  for (const w of weights) if (w > max) max = w;
  return max === 0 ? 0 : weightAt(t, meter, weights) / max;
}
