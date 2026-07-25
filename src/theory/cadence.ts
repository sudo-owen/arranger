import type { Chord, Harmony } from '../core/index.js';
import { numeralOf } from './roman.js';

export type Cadence = 'authentic' | 'half' | 'plagal' | 'deceptive' | 'none';

const isTonicTriad = (c: Chord): boolean =>
  c.quality === 'maj' || c.quality === 'min' || c.quality === 'maj7' || c.quality === 'min7';

/**
 * Classify the ending (spec §7.3). This is what decides whether the input is an
 * antecedent asking a question (→ write a consequent) or a closed statement
 * (→ write contrast). Only the last two chords matter.
 */
export function classifyCadence(h: Harmony): Cadence {
  const evs = h.events;
  const last = evs[evs.length - 1];
  const prev = evs[evs.length - 2];
  if (last === undefined) return 'none';

  const lastN = numeralOf(last.chord, h.key);
  const prevN = prev ? numeralOf(prev.chord, h.key) : 'other';

  if (prevN === 'V' && lastN === 'I' && isTonicTriad(last.chord)) return 'authentic';
  if (prevN === 'IV' && lastN === 'I') return 'plagal';
  if (prevN === 'V' && lastN === 'VI') return 'deceptive';
  if (lastN === 'V') return 'half';
  return 'none';
}

/** Open cadences ask a question; the extension writes an answer (§7.3). */
export function isOpen(c: Cadence): boolean {
  return c === 'half';
}
