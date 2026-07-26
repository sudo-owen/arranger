import type { ChordEvent, Form, Harmony, Meter, Midi, Motif, Tick } from '../core/index.js';
import { NEUTRAL_MOOD, barTicks, midi, tick } from '../core/index.js';

export interface GenContext {
  harmony: Harmony;
  form: Form;
  meter: Meter;
  source: Motif; // the user's melody — needed for the contour floor and wind/brass complementarity
}

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

export function pitchAt(m: Motif, t: Tick, fallback = 72): number {
  let p: number = m.notes[0]?.pitch ?? fallback;
  for (const n of m.notes) {
    if (n.start <= t) p = n.pitch;
    else break;
  }
  return p;
}

export function placePC(centre: number, pcValue: number): Midi {
  return midi(Math.round((centre - pcValue) / 12) * 12 + pcValue);
}

/** The degenerate form: one section spanning everything, at neutral. */
export function wholeForm(h: Harmony): Form {
  return {
    template: 'sentence',
    sections: [{ label: 'A', start: tick(0), length: h.length, mood: NEUTRAL_MOOD }],
  };
}

export const wholeContext = (harmony: Harmony, meter: Meter, source: Motif): GenContext =>
  ({ harmony, form: wholeForm(harmony), meter, source });

export const barCount = (h: Harmony, meter: Meter): number =>
  Math.max(1, Math.round(h.length / barTicks(meter)));
