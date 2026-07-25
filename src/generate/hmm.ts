import type { Chord, Harmony, Key, Meter, Motif, Note, Quality, Rng } from '../core/index.js';
import { barTicks, chordPCs, pc, tick, weightAt, weightsFor } from '../core/index.js';

/**
 * Harmony inference by hidden Markov model (spec §7.2). Bars are hidden states drawn
 * from a per-key vocabulary; the melody notes in each bar are the observations.
 *   • Viterbi → the MAP progression we SHOW the user (and they correct).
 *   • FFBS + temperature → coherent VARIATION (sample a whole path from the posterior,
 *     not independent marginals, or the progression falls apart).
 * The inference only needs to be plausible, not "right" — the user owns it after (§3.4).
 */

const EMIT_TONE = 0.9;
const EMIT_NCT = 0.1;

/** The per-key chord vocabulary: diatonic triads + V7 + secondary dominants + a few borrowed. Capped ~15 (§7.2). */
export function harmonyStates(key: Key): Chord[] {
  const t = key.tonic;
  const at = (semi: number, quality: Quality): Chord => ({ root: pc(t + semi), quality });

  const diatonic: Chord[] = key.mode === 'major'
    ? [at(0, 'maj'), at(2, 'min'), at(4, 'min'), at(5, 'maj'), at(7, 'maj'), at(7, 'dom7'), at(9, 'min'), at(11, 'dim')]
    : [at(0, 'min'), at(2, 'dim'), at(3, 'maj'), at(5, 'min'), at(7, 'min'), at(7, 'dom7'), at(8, 'maj'), at(10, 'maj')];

  // Secondary dominants: V7 of each tonicisable degree (a fifth above the target).
  const targets = key.mode === 'major' ? [2, 4, 5, 7, 9] : [3, 5, 8, 10];
  const secondary: Chord[] = targets.map((semi) => at(semi + 7, 'dom7'));

  const borrowed: Chord[] = key.mode === 'major'
    ? [at(5, 'min'), at(8, 'maj'), at(10, 'maj')] // iv, bVI, bVII
    : [];

  return dedup([...diatonic, ...secondary, ...borrowed]);
}

// ─── model probabilities (log space) ─────────────────────────────────────────

function logEmission(bar: readonly Note[], chord: Chord, meter: Meter, weights: readonly number[]): number {
  const tones = new Set<number>(chordPCs(chord));
  let logp = 0;
  let totalW = 0;
  for (const n of bar) {
    const w = n.duration * (1 + weightAt(n.start, meter, weights)); // duration × metric weight (§7.2)
    logp += w * Math.log(tones.has(pc(n.pitch)) ? EMIT_TONE : EMIT_NCT);
    totalW += w;
  }
  return totalW === 0 ? 0 : logp / totalW; // per-unit-weight avg → bars are comparable
}

const isTonic = (c: Chord, key: Key): boolean =>
  c.root === pc(key.tonic) && (key.mode === 'major' ? c.quality === 'maj' : c.quality === 'min');
const isDiatonicV = (c: Chord, key: Key): boolean => c.root === pc(key.tonic + 7);

const MOTION_SCORE: Readonly<Record<number, number>> = {
  5: 1.0, 2: 0.55, 7: 0.5, 10: 0.5, 9: 0.45, 3: 0.4, 8: 0.35, 4: 0.3, 0: 0.3, 1: 0.2, 11: 0.2, 6: 0.15,
};

function logTransition(from: Chord, to: Chord, key: Key): number {
  const motion = (((to.root - from.root) % 12) + 12) % 12; // 5 = down a fifth (the strong one)
  let s = MOTION_SCORE[motion] ?? 0.2;
  const secondaryDom = from.quality === 'dom7' && !isDiatonicV(from, key);
  if (secondaryDom) s += motion === 5 ? 0.6 : -0.3; // a secondary dominant wants to resolve down a fifth
  if (isTonic(to, key)) s += 0.1;
  return Math.log(Math.max(0.01, s));
}

function logPrior(chord: Chord, key: Key): number {
  if (isTonic(chord, key)) return Math.log(0.5);
  if (isDiatonicV(chord, key)) return Math.log(0.2);
  return Math.log(0.05);
}

// ─── observation slicing ─────────────────────────────────────────────────────

function barsOf(source: Motif, meter: Meter): Note[][] {
  const bar = barTicks(meter);
  const n = Math.max(1, Math.ceil(source.length / bar));
  const out: Note[][] = Array.from({ length: n }, () => []);
  for (const note of source.notes) {
    const b = Math.min(n - 1, Math.floor(note.start / bar));
    out[b]?.push(note);
  }
  return out;
}

function emissionMatrix(bars: Note[][], states: Chord[], meter: Meter, weights: readonly number[]): number[][] {
  return bars.map((bar) => states.map((s) => logEmission(bar, s, meter, weights)));
}

// ─── Viterbi (MAP path) ──────────────────────────────────────────────────────

function viterbi(bars: Note[][], states: Chord[], key: Key, meter: Meter, weights: readonly number[]): Chord[] {
  const T = bars.length;
  const N = states.length;
  const em = emissionMatrix(bars, states, meter, weights);
  const dp: number[][] = Array.from({ length: T }, () => new Array<number>(N).fill(-Infinity));
  const bp: number[][] = Array.from({ length: T }, () => new Array<number>(N).fill(0));

  const em0 = em[0] ?? [];
  const dp0 = dp[0] ?? [];
  states.forEach((s, j) => { dp0[j] = logPrior(s, key) + (em0[j] ?? 0); });

  for (let t = 1; t < T; t++) {
    const prev = dp[t - 1] ?? [];
    const cur = dp[t] ?? [];
    const back = bp[t] ?? [];
    const emt = em[t] ?? [];
    for (let j = 0; j < N; j++) {
      let best = -Infinity;
      let arg = 0;
      const toChord = states[j];
      if (!toChord) continue;
      for (let i = 0; i < N; i++) {
        const fromChord = states[i];
        if (!fromChord) continue;
        const v = (prev[i] ?? -Infinity) + logTransition(fromChord, toChord, key);
        if (v > best) { best = v; arg = i; }
      }
      cur[j] = best + (emt[j] ?? 0);
      back[j] = arg;
    }
  }

  const lastRow = dp[T - 1] ?? [];
  let last = 0;
  let bestV = -Infinity;
  for (let j = 0; j < N; j++) if ((lastRow[j] ?? -Infinity) > bestV) { bestV = lastRow[j] ?? -Infinity; last = j; }

  const path = new Array<number>(T).fill(0);
  path[T - 1] = last;
  for (let t = T - 1; t > 0; t--) path[t - 1] = (bp[t] ?? [])[path[t] ?? 0] ?? 0;
  return path.map((i) => states[i] ?? states[0] ?? { root: pc(key.tonic), quality: 'maj' });
}

// ─── Forward-filtering backward-sampling (variation) ─────────────────────────

function logSumExp(xs: readonly number[]): number {
  let max = -Infinity;
  for (const x of xs) if (x > max) max = x;
  if (max === -Infinity) return -Infinity;
  let sum = 0;
  for (const x of xs) sum += Math.exp(x - max);
  return max + Math.log(sum);
}

/** Sample an index from log-weights, tempered. Higher temperature → flatter → more surprising (§7.2). */
function sampleLog(logw: readonly number[], temperature: number, rng: Rng): number {
  const temp = Math.max(0.05, temperature);
  const scaled = logw.map((l) => l / temp);
  const z = logSumExp(scaled);
  if (!Number.isFinite(z)) return rng.int(logw.length);
  const probs = scaled.map((l) => Math.exp(l - z));
  let r = rng.next();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i] ?? 0;
    if (r <= 0) return i;
  }
  return probs.length - 1;
}

function ffbs(bars: Note[][], states: Chord[], key: Key, meter: Meter, weights: readonly number[], temperature: number, rng: Rng): Chord[] {
  const T = bars.length;
  const N = states.length;
  const em = emissionMatrix(bars, states, meter, weights);
  const alpha: number[][] = Array.from({ length: T }, () => new Array<number>(N).fill(-Infinity));

  const a0 = alpha[0] ?? [];
  const em0 = em[0] ?? [];
  states.forEach((s, j) => { a0[j] = logPrior(s, key) + (em0[j] ?? 0); });

  for (let t = 1; t < T; t++) {
    const prev = alpha[t - 1] ?? [];
    const cur = alpha[t] ?? [];
    const emt = em[t] ?? [];
    for (let j = 0; j < N; j++) {
      const toChord = states[j];
      if (!toChord) continue;
      const terms = states.map((fromChord, i) => (prev[i] ?? -Infinity) + logTransition(fromChord, toChord, key));
      cur[j] = logSumExp(terms) + (emt[j] ?? 0);
    }
  }

  const path = new Array<number>(T).fill(0);
  path[T - 1] = sampleLog(alpha[T - 1] ?? [], temperature, rng);
  for (let t = T - 1; t > 0; t--) {
    const prev = alpha[t - 1] ?? [];
    const nextChord = states[path[t] ?? 0];
    const w = states.map((fromChord, i) => (prev[i] ?? -Infinity) + (nextChord ? logTransition(fromChord, nextChord, key) : 0));
    path[t - 1] = sampleLog(w, temperature, rng);
  }
  return path.map((i) => states[i] ?? states[0] ?? { root: pc(key.tonic), quality: 'maj' });
}

// ─── assembly ────────────────────────────────────────────────────────────────

function harmonyFromPath(path: Chord[], key: Key, meter: Meter, length: number): Harmony {
  const bar = barTicks(meter);
  const events = path.map((chord, b) => {
    const start = b * bar;
    const dur = b === path.length - 1 ? Math.max(bar, length - start) : bar;
    return { start: tick(start), duration: tick(dur), chord };
  });
  return { key, events, length: tick(length) };
}

/** MAP harmony to show the user (spec §7.2, Viterbi). */
export function inferHarmony(source: Motif, key: Key, meter: Meter): Harmony {
  const states = harmonyStates(key);
  const bars = barsOf(source, meter);
  return harmonyFromPath(viterbi(bars, states, key, meter, weightsFor(meter)), key, meter, source.length);
}

/** A sampled harmony variation at a given temperature (spec §7.2, FFBS). */
export function sampleHarmony(source: Motif, key: Key, meter: Meter, temperature: number, rng: Rng): Harmony {
  const states = harmonyStates(key);
  const bars = barsOf(source, meter);
  return harmonyFromPath(ffbs(bars, states, key, meter, weightsFor(meter), temperature, rng), key, meter, source.length);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function dedup(chords: Chord[]): Chord[] {
  const seen = new Set<string>();
  const out: Chord[] = [];
  for (const c of chords) {
    const k = `${String(c.root)}:${c.quality}`;
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out;
}
