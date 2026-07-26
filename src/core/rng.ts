/**
 * Seeded, deterministic PRNG — sfc32 (spec §8.1). The "genome is a seed" thesis
 * (§3.6) and the golden determinism tests (§11) both rest on this: same seed ⇒
 * same stream, on every engine, forever. sfc32 uses only 32-bit integer ops, so
 * it is stable across platforms. It is not cryptographic and does not need to be.
 *
 * `Math.random()` is BANNED in core/theory/generate/critic (§8.1) — one stray call
 * breaks every golden test loudly, which is exactly what you want.
 */

export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  range(min: number, max: number): number;
  bool(p?: number): boolean;
  pick<T>(xs: readonly T[]): T;
  /**
   * A fresh, independent stream derived from a LABEL, not from the running state.
   *
   * §8.2. ornament() draws a variable number of randoms depending on how many notes
   * it adds. If a child stream were derived from the
   * parent's mutated state, changing ornament's density would silently rerandomise
   * every later role — the user nudges one slider and a variation they liked
   * evaporates. Seeding from hash(seed0, label) makes each stream a pure function of
   * the original seed and its label, independent of consumption order.
   */
  fork(label: string): Rng;
}

function seedWords(seed: number): [number, number, number, number] {
  let a = seed >>> 0;
  const nextWord = (): number => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
  return [nextWord(), nextWord(), nextWord(), nextWord()];
}

function hashSeed(seed: number, label: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  const seed0 = seed >>> 0; // immutable: fork() derives from this, never from a/b/c/d
  let [a, b, c, d] = seedWords(seed0);

  const next = (): number => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  const range = (min: number, max: number): number => min + next() * (max - min);
  const bool = (p = 0.5): boolean => next() < p;

  const pick = <T>(xs: readonly T[]): T => {
    if (xs.length === 0) throw new Error('rng.pick() from empty array');
    const v = xs[Math.floor(next() * xs.length)];
    if (v === undefined) throw new Error('rng.pick() index out of range');
    return v;
  };

  const fork = (label: string): Rng => makeRng(hashSeed(seed0, label));

  return { next, int, range, bool, pick, fork };
}
