import type { ChordEvent, Context, Note } from '../core/index.js';
import { beatTicks, isChordTone, normWeightAt } from '../core/index.js';

/**
 * A crude Schenkerian reduction (spec §7.1). Getting this right is the difference
 * between "an arrangement" and "a computer": harmonise every passing tone as a
 * chord tone and the brass turns to mud and the inference invents exotic chords to
 * explain an accented F#. Budget real time here.
 */
export type NCT = 'chordTone' | 'passing' | 'neighbor' | 'appoggiatura' | 'suspension';

/** A note is structural if metrically strong, long, or on a phrase boundary. */
export function isStructural(n: Note, ctx: Context, phraseBoundary = false): boolean {
  const w = normWeightAt(n.start, ctx.meter, ctx.weights);
  const strong = w >= 0.5; // weight ≥ 2 on the 0–4 grid
  const long = n.duration >= beatTicks(ctx.meter);
  return strong || long || phraseBoundary;
}

function chordAt(events: readonly ChordEvent[], t: number): ChordEvent | undefined {
  let hit: ChordEvent | undefined;
  for (const e of events) {
    if (e.start <= t && t < e.start + e.duration) return e;
    if (e.start <= t) hit = e;
  }
  return hit;
}

/**
 * Classify a single note given its neighbours and the harmony. `prev`/`next` are the
 * adjacent notes in the line (undefined at the edges).
 */
export function classifyNote(
  prev: Note | undefined, n: Note, next: Note | undefined, ctx: Context,
): NCT {
  const ev = chordAt(ctx.harmony, n.start);
  if (ev && isChordTone(n.pitch, ev.chord)) return 'chordTone';

  const up = (a: number, b: number): number => b - a;
  const stepIn = prev ? up(prev.pitch, n.pitch) : 0;
  const stepOut = next ? up(n.pitch, next.pitch) : 0;
  const isStep = (x: number): boolean => Math.abs(x) === 1 || Math.abs(x) === 2;
  const isLeap = (x: number): boolean => Math.abs(x) >= 3;

  // Suspension: held over from the previous note, then falls by step.
  if (prev && prev.pitch === n.pitch && next && stepOut < 0 && isStep(stepOut)) {
    return 'suspension';
  }
  // Neighbour: steps away and returns to the same pitch.
  if (prev && next && prev.pitch === next.pitch && isStep(stepIn) && isStep(stepOut)) {
    return 'neighbor';
  }
  // Passing: stepwise motion in a consistent direction through the note.
  if (isStep(stepIn) && isStep(stepOut) && Math.sign(stepIn) === Math.sign(stepOut)) {
    return 'passing';
  }
  // Appoggiatura: approached by leap, resolved by step in the opposite direction.
  if (isLeap(stepIn) && isStep(stepOut) && Math.sign(stepIn) !== Math.sign(stepOut)) {
    return 'appoggiatura';
  }
  return 'passing';
}

export interface TaggedNote {
  note: Note;
  nct: NCT;
  structural: boolean;
}

/** Tag every note of a line with its structural role and NCT classification. */
export function reduce(line: readonly Note[], ctx: Context): TaggedNote[] {
  return line.map((note, i) => ({
    note,
    structural: isStructural(note, ctx, i === 0 || i === line.length - 1),
    nct: classifyNote(line[i - 1], note, line[i + 1], ctx),
  }));
}
