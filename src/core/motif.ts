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

/** Map each note, then re-establish the sort invariant. */
export function mapNotes(m: Motif, fn: (n: Note) => Note): Motif {
  return motif(m.notes.map(fn), m.length);
}

/** Replace the note list (re-sorted), keeping length. */
export function withNotes(m: Motif, notes: readonly Note[]): Motif {
  return motif(notes, m.length);
}

/** Dev-only invariant check. O(n); call in tests or behind a debug flag. */
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
