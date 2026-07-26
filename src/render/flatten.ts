import type { Arrangement, Role, TimbreName } from '../core/index.js';
import { LEAD, secPerTick, timbreNameFor } from '../core/index.js';

export interface FlatEvent {
  /** Seconds from loop start. */
  time: number;
  role: Role;
  /** Null for percussion, which is a drum map rather than a pitched voice. */
  timbre: TimbreName | null;
  pitch: number;
  velocity: number;
  durSec: number;
}

/**
 * Percussion is decided by ROLE, not by a missing instrument. Keying off the absent
 * instrument meant any track built without one played as a drum solo, which callers
 * then worked around by attaching a lead they did not otherwise need.
 */
export function flatten(arr: Arrangement, bpm: number): FlatEvent[] {
  const spt = secPerTick(bpm);
  const out: FlatEvent[] = [];
  for (const tr of arr.tracks) {
    const timbre = tr.role === 'drums' ? null : timbreNameFor(tr.instrument ?? LEAD);
    for (const n of tr.motif.notes) {
      out.push({
        time: n.start * spt,
        role: tr.role,
        timbre,
        pitch: n.pitch,
        velocity: n.velocity,
        durSec: Math.max(0.03, n.duration * spt),
      });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}
