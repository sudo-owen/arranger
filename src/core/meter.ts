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

export function barTicks(meter: Meter): number {
  return (meter.num * (PPQ * 4)) / meter.den;
}

export function beatTicks(meter: Meter): number {
  return (PPQ * 4) / meter.den;
}

export function sixteenthsPerBar(meter: Meter): number {
  return barTicks(meter) / sixteenth();
}

export function beatInBar(t: number, meter: Meter): number {
  const bar = barTicks(meter);
  return Math.floor((((t % bar) + bar) % bar) / beatTicks(meter));
}

export function barsIn(length: number, meter: Meter): number {
  return Math.max(1, Math.round(length / barTicks(meter)));
}

/**
 * Seconds per tick — the single conversion between the engine's tick domain and the
 * audio clock. Named rather than open-coded, so the conversion has one definition.
 */
export function secPerTick(bpm: number): number {
  return 60 / bpm / PPQ;
}

export function weightAt(t: Tick, meter: Meter, weights: readonly number[]): number {
  const bar = barTicks(meter);
  const posInBar = ((t % bar) + bar) % bar;
  const w = weights[Math.floor(posInBar / sixteenth()) % weights.length];
  return w === undefined ? 0 : w;
}

// Called per note by the dynamics pass and by every operator that reads metric weight,
// so the grid's max is cached against the array rather than rescanned each time.
const maxima = new WeakMap<readonly number[], number>();

export function normWeightAt(t: Tick, meter: Meter, weights: readonly number[]): number {
  let max = maxima.get(weights);
  if (max === undefined) {
    max = weights.reduce((a, w) => (w > a ? w : a), 0);
    maxima.set(weights, max);
  }
  return max === 0 ? 0 : weightAt(t, meter, weights) / max;
}
