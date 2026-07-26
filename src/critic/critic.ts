import type { Arrangement, Meter, Motif, Note } from '../core/index.js';
import { CRASH, PPQ, ROLE_ORDER, barTicks, inRange, pc, secPerTick, specFor } from '../core/index.js';
import { contourSimilarity, cosine, CONTOUR_FLOOR } from '../theory/index.js';

/**
 * The critic checks HARD constraints only (spec §7.5). Scoring musicality is
 * unsolved and stays off the critical path. v1 enforces the physically-grounded
 * rules — instrument range, articulation rate, phrase length, and the melody
 * contour floor. (The two harmonic rules — inner-voice dissonance on weight-4 beats
 * and outer-voice parallels — need voice separation and are a documented TODO.)
 *
 * Range applies to everything. Articulation and breath apply only to ACOUSTIC voices
 * playing a MONOPHONIC line — the two conditions the underlying model actually
 * assumes. A pulse channel has no tongue to outrun, and `runSeconds` measures a
 * single line, so pointing it at a block-voiced brass stack yields a number that
 * means nothing. Both gates read the voice rather than the role name: which roles are
 * acoustic is a property of the palette, and any role can be either.
 */

function isMonophonic(m: Motif): boolean {
  for (let i = 1; i < m.notes.length; i++) {
    const prev = m.notes[i - 1]!;
    if (m.notes[i]!.start < prev.start + prev.duration) return false;
  }
  return true;
}

export function violations(arr: Arrangement, source: Motif, bpm: number): string[] {
  const out: string[] = [];
  const spt = secPerTick(bpm);

  for (const track of arr.tracks) {
    const inst = track.instrument;
    if (!inst) continue; // percussion: no pitched range

    for (const n of track.motif.notes) {
      if (!inRange(n.pitch, inst)) { out.push(`${track.role}: ${n.pitch} out of ${inst.name} range`); break; }
    }

    if (inst.class !== 'acoustic') continue; // chip voices: range is the only physical limit
    const spec = specFor(inst);
    if (!spec || !isMonophonic(track.motif)) continue;

    const notes = track.motif.notes;
    const minGap = 1 / spec.notesPerSec;
    for (let i = 1; i < notes.length; i++) {
      const gap = (notes[i]!.start - notes[i - 1]!.start) * spt;
      if (gap > 0 && gap < minGap) { out.push(`${track.role}: articulation faster than ${inst.name} can play at ${bpm} BPM`); break; }
    }
    // Sections carry `maxPhraseSec: Infinity` — staggered breathing is encoded in the
    // limit itself, so there is no separate `section` test to fall out of sync with it.
    if (runSeconds(notes, spt) > spec.maxPhraseSec) {
      out.push(`${track.role}: phrase exceeds ${spec.maxPhraseSec}s without a rest`);
    }
  }

  // The one aesthetic hard-reject (§3.7): melody must stay kin to the source.
  const melody = arr.tracks.find((t) => t.role === 'melody');
  if (melody && contourSimilarity(melody.motif, source) < CONTOUR_FLOOR) {
    out.push(`melody: contour similarity below ${CONTOUR_FLOOR}`);
  }
  return out;
}

export const isValid = (arr: Arrangement, source: Motif, bpm: number): boolean =>
  violations(arr, source, bpm).length === 0;

/**
 * The track loops forever in game, so the return point follows the last bar more often
 * than any other pair in the piece — and it is the one join nothing else checks.
 *
 * `loopStart` is where playback returns to, which is not necessarily tick 0: a track with
 * an intro plays its head once and loops the body. Every check below is about that join,
 * so all three read it rather than assuming bar 1.
 */
export function loopSeamProblems(arr: Arrangement, meter: Meter, loopStart = 0): string[] {
  const out: string[] = [];
  const events = arr.harmony.events;
  const returnTo = events.find((e) => e.start <= loopStart && loopStart < e.start + e.duration)
    ?? events[0];
  const first = returnTo?.chord;
  const last = events.at(-1)?.chord;
  if (first && last) {
    const motion = pc(first.root - last.root);
    // Authentic (V→I, 5), plagal (IV→I, 7), step approaches (2, 10), or staying put.
    // Omitting the plagal return rejects `heroic-major`, the default major progression.
    if (![0, 2, 5, 7, 10].includes(motion)) {
      out.push(`loop seam: last chord does not lead back to the return point (${motion} semitones)`);
    }
  }

  const drums = arr.tracks.find((t) => t.role === 'drums');
  if (drums) {
    const lastBar = arr.length - barTicks(meter);
    const crashAtReturn = drums.motif.notes.some((n) => n.pitch === CRASH && n.start === loopStart);
    if (crashAtReturn && drums.motif.notes.some((n) => n.pitch === CRASH && n.start >= lastBar)) {
      out.push('loop seam: a crash in the final bar collides with the crash at the return point');
    }
  }

  for (const track of arr.tracks) {
    if (track.motif.notes.some((n) => n.start + n.duration > arr.length)) {
      out.push(`loop seam: ${track.role} sustains past the loop point`);
      break;
    }
  }
  return out;
}

function runSeconds(notes: readonly Note[], spt: number): number {
  let longest = 0;
  let runStart: number | null = null;
  let prevEnd = 0;
  for (const n of notes) {
    if (runStart === null || n.start > prevEnd + 1) runStart = n.start; // a gap resets the phrase
    prevEnd = n.start + n.duration;
    longest = Math.max(longest, (prevEnd - runStart) * spt);
  }
  return longest;
}

// ─── diversity selection (spec §7.6) ─────────────────────────────────────────

export function featureVector(arr: Arrangement): number[] {
  const hist = new Array<number>(12).fill(0);
  let total = 0;
  for (const t of arr.tracks) for (const n of t.motif.notes) { hist[n.pitch % 12] = (hist[n.pitch % 12] ?? 0) + 1; total++; }
  const pcHist = hist.map((h) => (total ? h / total : 0));

  const bars = Math.max(1, arr.length / PPQ);
  const density = ROLE_ORDER.map((role) => {
    const tr = arr.tracks.find((t) => t.role === role);
    return tr ? tr.motif.notes.length / bars : 0;
  });

  const mel = arr.tracks.find((t) => t.role === 'melody')?.motif.notes ?? [];
  let intervalSum = 0;
  for (let i = 1; i < mel.length; i++) intervalSum += Math.abs(mel[i]!.pitch - mel[i - 1]!.pitch);
  const meanInterval = mel.length > 1 ? intervalSum / (mel.length - 1) / 12 : 0;

  return [...pcHist, ...density.map((d) => d / 8), meanInterval];
}

export interface Scored {
  features: number[];
  score: number;
}

/**
 * Greedy MMR selection (spec §7.6): rank for quality, then spread. Without this the
 * grid is six near-identical candidates — "an expensive way to hear the same thing
 * six times." `lambda` is the surprise dial. Returns indices into `items`.
 */
export function selectDiverse(items: readonly Scored[], k: number, lambda: number): number[] {
  if (items.length === 0) return [];
  const remaining = items.map((_, i) => i);
  const best = remaining.reduce((a, b) => ((items[b]?.score ?? 0) > (items[a]?.score ?? 0) ? b : a), remaining[0]!);
  const picked = [best];
  remaining.splice(remaining.indexOf(best), 1);

  while (picked.length < k && remaining.length > 0) {
    let choice = remaining[0]!;
    let bestVal = -Infinity;
    for (const i of remaining) {
      const item = items[i]!;
      const maxSim = Math.max(...picked.map((p) => cosine(item.features, items[p]!.features)));
      const val = item.score - lambda * maxSim;
      if (val > bestVal) { bestVal = val; choice = i; }
    }
    picked.push(choice);
    remaining.splice(remaining.indexOf(choice), 1);
  }
  return picked;
}
