import type { Context, Key, Meter, Motif, Note, Rng, Tick } from '../core/index.js';
import {
  PPQ, barTicks, fromDiatonicDegree, makeRng, motif, sequence, tick, toDiatonicDegree, weightsFor,
} from '../core/index.js';

/**
 * The hook — a short cell plus how it comes back.
 *
 * This exists because a memorable battle theme is not a longer melody, it is a SHORT
 * one you hear four times. The previous seed generator was a random walk over an
 * eighth grid: every note a fresh choice, nothing recurring, nothing to remember. You
 * cannot hum a random walk.
 *
 * Two constraints do most of the work, and both run against the intuition that more
 * choice makes a better tune:
 *
 * 1. **Rhythm first.** The cell's rhythm is drawn from a small library of battle
 *    figures, not generated. Rhythm is what makes a hook identifiable — you recognise
 *    the Mario theme from clapping alone.
 * 2. **Three to five pitches.** Pitches come from a fixed small set per cell, so the
 *    tune keeps returning to the same handful of notes. Mario's hook is three pitches.
 *    Widening this is the single fastest way to make a hook forgettable.
 *
 * Restatement then reuses the existing operator algebra (§6.1) rather than inventing
 * anything: `sequence` handles the repeats and step-transposed answers.
 */

export type RestatementScheme =
  /** A A — the cell twice, unchanged. Blunt and extremely sticky. */
  | 'immediate'
  /** A A↑ — restate a diatonic step higher. The Pokémon R/B battle gesture. */
  | 'sequence-up'
  /** A A↓ — restate a step lower; reads as settling rather than rising. */
  | 'sequence-down'
  /** A B — the answer turns down toward the tonic, so the pair closes. */
  | 'answer'
  /** A A A A — a riff that cycles underneath instead of a phrase that ends. */
  | 'ostinato';

export type RhythmName = 'driving-8ths' | 'gallop' | 'syncopated-16ths' | 'fanfare' | 'march';

export const HOOK_SCHEMES: readonly RestatementScheme[] =
  ['immediate', 'sequence-up', 'sequence-down', 'answer', 'ostinato'];
export const HOOK_RHYTHMS: readonly RhythmName[] =
  ['driving-8ths', 'gallop', 'syncopated-16ths', 'fanfare', 'march'];

/** Figures as [startSixteenth, lengthSixteenths] within one 4/4 bar. */
const RHYTHMS: Readonly<Record<RhythmName, readonly (readonly [number, number])[]>> = {
  'driving-8ths': [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
  gallop: [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2], [8, 1], [9, 1], [10, 2], [12, 4]],
  'syncopated-16ths': [[0, 2], [3, 1], [4, 2], [6, 2], [9, 1], [10, 2], [12, 2], [15, 1]],
  fanfare: [[0, 3], [3, 1], [4, 4], [8, 2], [10, 2], [12, 4]],
  march: [[0, 4], [4, 2], [6, 2], [8, 4], [12, 4]],
};

/**
 * Diatonic degree offsets a cell may use. Every set is built on the tonic triad, so
 * the cell is consonant against i/I no matter which progression it later sits over —
 * which is what lets stage 2 swap the harmony underneath without breaking the tune.
 */
const PITCH_SETS: readonly (readonly number[])[] = [
  [0, 2, 4],       // bare triad — the stickiest, and the most limited
  [0, 2, 4, 7],    // triad + octave, room to leap
  [0, 1, 2, 4],    // adds the 2nd, stepwise colour
  [0, 2, 3, 4],    // adds the 4th, a suspension flavour
  [0, 2, 4, 6],    // adds the 7th, the most restless
];

export interface Hook {
  cell: Motif;
  scheme: RestatementScheme;
  rhythm: RhythmName;
  key: Key;
  meter: Meter;
  cellBars: number;
}

export interface HookOptions {
  seed: number;
  key: Key;
  meter: Meter;
  /** 1 or 2. Two-bar cells breathe; one-bar cells hammer. */
  cellBars: number;
  scheme: RestatementScheme;
  rhythm: RhythmName;
  /** Base absolute scale degree — roughly middle C at 35. */
  centre?: number;
}

/** Sixteenths in one bar. (Assumes a /4 denominator, which is every battle meter here.) */
const sixteenthsPerBar = (meter: Meter): number => Math.round(meter.num * 4 * (4 / meter.den));

/** Fold an out-of-range index back inside, so a step at the edge still MOVES. */
function reflect(i: number, len: number): number {
  let v = i < 0 ? -i : i;
  if (v > len - 1) v = 2 * (len - 1) - v;
  return Math.max(0, Math.min(len - 1, v));
}

/**
 * Choose which set member each onset takes.
 *
 * Two guards, both learned the hard way: the anchor cannot be hammered for a whole
 * cell (or every downbeat is the tonic), and weak steps REFLECT at the edges rather
 * than clamping (or a walk that hits the bottom sticks there). Without them some
 * seeds produced a cell on a single repeated pitch — rhythmically fine, musically
 * nothing. The final pass makes "at least three pitches" an invariant rather than a
 * tendency.
 */
function planIndices(strong: readonly boolean[], setLen: number, rng: Rng): number[] {
  const anchors = [0, Math.min(2, setLen - 1)];
  const out: number[] = [];
  let idx = 0;
  let anchor = 0;
  let run = 0;

  for (const isStrong of strong) {
    if (isStrong) {
      let a = rng.bool(0.55) ? 0 : 1;
      if (a === anchor && run >= 2) a = 1 - a;
      run = a === anchor ? run + 1 : 0;
      anchor = a;
      idx = anchors[a]!;
    } else {
      idx = reflect(idx + (rng.bool() ? 1 : -1) * (rng.bool(0.25) ? 2 : 1), setLen);
    }
    out.push(idx);
  }

  // Guarantee the cell actually travels. Rewrite the LAST weak onsets, so the opening
  // gesture — the part you remember — is never the thing that gets patched.
  const want = Math.min(3, setLen);
  const weak: number[] = [];
  strong.forEach((s, i) => { if (!s) weak.push(i); });
  for (let v = 0; v < setLen && new Set(out).size < want; v++) {
    if (out.includes(v)) continue;
    const slot = weak.pop();
    if (slot === undefined) break;
    out[slot] = v;
  }
  return out;
}

export function generateHook(o: HookOptions): Hook {
  const rng = makeRng(o.seed);
  const sixteenth = PPQ / 4;
  const perBar = sixteenthsPerBar(o.meter);
  const set = PITCH_SETS[rng.int(PITCH_SETS.length)]!;
  const base = o.centre ?? 35;
  const figure = RHYTHMS[o.rhythm];

  const onsets: { start: number; duration: number; strong: boolean }[] = [];
  for (let bar = 0; bar < o.cellBars; bar++) {
    for (const [at, len] of figure) {
      if (at >= perBar) continue;
      onsets.push({
        start: (bar * perBar + at) * sixteenth,
        duration: Math.min(len, perBar - at) * sixteenth,
        strong: at % 4 === 0,
      });
    }
  }

  const idxs = planIndices(onsets.map((n) => n.strong), set.length, rng);
  const notes: Note[] = onsets.map((n, i) => ({
    start: tick(n.start),
    duration: tick(n.duration),
    pitch: fromDiatonicDegree(base + set[idxs[i]!]!, o.key),
    velocity: n.strong ? 104 : 88,
  }));

  return {
    cell: motif(notes, tick(o.cellBars * barTicks(o.meter))),
    scheme: o.scheme, rhythm: o.rhythm, key: o.key, meter: o.meter, cellBars: o.cellBars,
  };
}

/** Silence at the end of each phrase, in sixteenths. An eighth note of air. */
export const DEFAULT_BREATH = 2;

/**
 * Render the hook out to exactly `bars` bars, restating per its scheme, with a breath
 * at the end of every phrase.
 *
 * The breath is not decoration. Four of the five rhythm figures fill every sixteenth
 * of the bar, so tiling them straight produced one unbroken 23-second line — no
 * player could sustain it, and more to the point nobody wants to listen to a melody
 * that never stops for two minutes of combat. Phrasing is what makes a repeated hook
 * bearable, and it is what lets an acoustic voice carry one at all.
 */
export function renderHook(h: Hook, bars: number, breathSixteenths = DEFAULT_BREATH): Motif {
  const barT = barTicks(h.meter);
  const target = tick(bars * barT);
  const unit = statement(h);

  // Breathe per PHRASE, and a phrase is at least two bars. Without the floor, a
  // one-bar ostinato would gasp every bar instead of singing.
  const minPhrase = 2 * barT;
  const phrase = unit.length >= minPhrase
    ? unit
    : tileTo(unit, tick(Math.ceil(minPhrase / Math.max(1, unit.length)) * unit.length));

  return tileTo(breathe(phrase, breathSixteenths * (PPQ / 4)), target);
}

/** Clear the last `ticks` of a phrase, trimming any note that runs into it. */
function breathe(m: Motif, ticks: number): Motif {
  if (ticks <= 0 || m.length <= ticks) return m;
  const cutoff = m.length - ticks;
  const notes: Note[] = [];
  for (const n of m.notes) {
    if (n.start >= cutoff) continue;
    notes.push({ ...n, duration: tick(Math.max(1, Math.min(n.start + n.duration, cutoff) - n.start)) });
  }
  return motif(notes, m.length);
}

/** One complete statement of the hook — usually the cell and its answer. */
export function statement(h: Hook): Motif {
  const ctx: Context = { key: h.key, harmony: [], meter: h.meter, weights: weightsFor(h.meter) };
  switch (h.scheme) {
    case 'immediate': return sequence(h.cell, ctx, 0, 2, 'diatonic');
    case 'sequence-up': return sequence(h.cell, ctx, 1, 2, 'diatonic');
    case 'sequence-down': return sequence(h.cell, ctx, -1, 2, 'diatonic');
    case 'ostinato': return h.cell;
    case 'answer': return answer(h);
    default: {
      const never: never = h.scheme;
      throw new Error(`unhandled restatement scheme: ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Call and response: the second half keeps the rhythm but bends its tail downward, so
 * the pair reads as a question that gets answered rather than a phrase said twice.
 */
function answer(h: Hook): Motif {
  const len = h.cell.length;
  const turnAt = Math.floor(h.cell.notes.length * 0.6);
  const notes: Note[] = [...h.cell.notes];
  h.cell.notes.forEach((n, i) => {
    const degree = toDiatonicDegree(n.pitch, h.key);
    const fall = i < turnAt ? 0 : Math.min(3, i - turnAt + 1);
    notes.push({
      ...n,
      start: tick(n.start + len),
      pitch: fromDiatonicDegree(degree - fall, h.key),
      velocity: Math.max(60, n.velocity - 6),
    });
  });
  return motif(notes, tick(len * 2));
}

/** Repeat `m` until it fills `target`, clipping the final pass. */
function tileTo(m: Motif, target: Tick): Motif {
  if (m.length <= 0) return motif([], target);
  const notes: Note[] = [];
  for (let offset = 0; offset < target; offset += m.length) {
    for (const n of m.notes) {
      const start = n.start + offset;
      if (start >= target) break;
      notes.push({ ...n, start: tick(start), duration: tick(Math.min(n.duration, target - start)) });
    }
  }
  return motif(notes, target);
}

// ─── description helpers (the card copy) ─────────────────────────────────────

export const SCHEME_LABEL: Readonly<Record<RestatementScheme, string>> = {
  immediate: 'repeat', 'sequence-up': 'sequence ↑', 'sequence-down': 'sequence ↓',
  answer: 'call + answer', ostinato: 'ostinato',
};

export const RHYTHM_LABEL: Readonly<Record<RhythmName, string>> = {
  'driving-8ths': 'Driving 8ths', gallop: 'Gallop', 'syncopated-16ths': 'Syncopated 16ths',
  fanfare: 'Fanfare', march: 'March',
};

/** How many distinct pitches the cell actually uses — the memorability number. */
export function distinctPitches(h: Hook): number {
  return new Set(h.cell.notes.map((n) => n.pitch)).size;
}

/**
 * A set of hooks to choose between.
 *
 * Rhythm and scheme ROTATE from a single random offset rather than being drawn per
 * card. Drawing independently means collisions: a six-card set would routinely show
 * four cards on the same rhythm, which wastes most of the choice you are being asked
 * to make. Rotation guarantees every rhythm and every scheme appears before any
 * repeats.
 */
export function generateHookSet(key: Key, meter: Meter, rng: Rng, count: number): Hook[] {
  const rhythmOffset = rng.int(HOOK_RHYTHMS.length);
  const schemeOffset = rng.int(HOOK_SCHEMES.length);
  const out: Hook[] = [];
  for (let i = 0; i < count; i++) {
    out.push(generateHook({
      seed: rng.int(1_000_000_000),
      key,
      meter,
      cellBars: rng.bool(0.7) ? 2 : 1,
      scheme: HOOK_SCHEMES[(i + schemeOffset) % HOOK_SCHEMES.length]!,
      rhythm: HOOK_RHYTHMS[(i + rhythmOffset) % HOOK_RHYTHMS.length]!,
    }));
  }
  return out;
}
