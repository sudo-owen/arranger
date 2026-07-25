import type { ChordEvent, Form, Harmony, Meter, Midi, Motif, Tick } from '../core/index.js';
import { barTicks, midi, tick } from '../core/index.js';

/** Everything the role generators read. Harmony is owned (spec §3.3); roles are functions of it. */
export interface GenContext {
  harmony: Harmony;
  form: Form;
  meter: Meter;
  source: Motif; // the user's melody — needed for the contour floor and wind/brass complementarity
}

/** The chord sounding at tick t (events are contiguous; clamps to the last). */
export function chordAt(h: Harmony, t: Tick): ChordEvent {
  let hit: ChordEvent | undefined;
  for (const e of h.events) {
    if (e.start <= t && t < e.start + e.duration) return e;
    if (e.start <= t) hit = e;
  }
  const first = h.events[0];
  if (hit) return hit;
  if (first) return first;
  throw new Error('chordAt: empty harmony');
}

/** Sounding pitch of a line at tick t (sample-and-hold). */
export function pitchAt(m: Motif, t: Tick, fallback = 72): number {
  let p: number = m.notes[0]?.pitch ?? fallback;
  for (const n of m.notes) {
    if (n.start <= t) p = n.pitch;
    else break;
  }
  return p;
}

/** Place a pitch class in the octave nearest a MIDI centre. */
export function placePC(centre: number, pcValue: number): Midi {
  return midi(Math.round((centre - pcValue) / 12) * 12 + pcValue);
}

/** A single-section form spanning the whole harmony — handy default for tests. */
export function wholeForm(h: Harmony): Form {
  return {
    template: 'sentence',
    sections: [{ label: 'A', start: tick(0), length: h.length, density: 0.7, roles: ['melody', 'bass', 'drums', 'winds', 'brass'] }],
  };
}

export const barCount = (h: Harmony, meter: Meter): number =>
  Math.max(1, Math.round(h.length / barTicks(meter)));
