import type { Tick } from './brand.js';
import { tick } from './brand.js';
import type { Motif, Note } from './types.js';

export const noteEnd = (n: Note): Tick => tick(n.start + n.duration);

/**
 * Construct a Motif: sorts notes by start (stable) and derives length from the max
 * note end if not given. Sorting here is what lets every operator rely on the
 * sorted-by-start invariant without re-checking.
 */
export function motif(notes: readonly Note[], length?: Tick): Motif {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const end = sorted.reduce((m, n) => Math.max(m, noteEnd(n)), 0);
  return { notes: sorted, length: length ?? tick(end) };
}

/** Notes falling in [start, start+length), rebased to zero. */
export function sliceAt(m: Motif, start: number, length: number): Motif {
  const notes = m.notes
    .filter((n) => n.start >= start && n.start < start + length)
    .map((n) => ({ ...n, start: tick(n.start - start), duration: tick(Math.min(n.duration, length - (n.start - start))) }));
  return motif(notes, tick(length));
}

/**
 * Repeat `m` until it covers `target`, dropping anything that would cross the end.
 * Both callers need it for the same reason: material whose natural length is shorter
 * than the span it has to fill — a hook cell against a phrase, a halved section
 * against the section it belongs to.
 */
export function tileTo(m: Motif, target: Tick): Motif {
  if (m.length <= 0 || !m.notes.length) return motif([], target);
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

export function mapNotes(m: Motif, fn: (n: Note) => Note): Motif {
  return motif(m.notes.map(fn), m.length);
}

export function withNotes(m: Motif, notes: readonly Note[]): Motif {
  return motif(notes, m.length);
}

export function assertMotif(m: Motif): void {
  for (let i = 1; i < m.notes.length; i++) {
    const prev = m.notes[i - 1];
    const cur = m.notes[i];
    if (prev === undefined || cur === undefined) continue;
    if (cur.start < prev.start) {
      throw new Error(`Motif not sorted by start at index ${i}`);
    }
  }
}
