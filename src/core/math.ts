export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
export const clamp01 = (x: number): number => clamp(x, 0, 1);
export const lerp = (lo: number, hi: number, t: number): number => lo + (hi - lo) * clamp01(t);

/**
 * Shift `base` by a signed amount, centred so `t = 0.5` is a no-op.
 *
 * The difference between this and `lerp` is the whole reason mood is worth authoring
 * against: `lerp` throws the incoming value away, so every take deforms to the same
 * numbers and the arrangement you picked stops existing. `bias` keeps a busier take
 * relatively busier at every mood.
 */
export const bias = (base: number, t: number, amount: number): number =>
  clamp01(base + (clamp01(t) - 0.5) * amount);
