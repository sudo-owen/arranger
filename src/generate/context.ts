import type { ChordEvent, Form, Harmony, Meter, Midi, Mood, Motif, Tick } from '../core/index.js';
import { NEUTRAL_MOOD, barTicks, midi, tick } from '../core/index.js';

export interface GenContext {
  harmony: Harmony;
  form: Form;
  meter: Meter;
  source: Motif; // the user's melody — needed for the contour floor and wind/brass complementarity
  /**
   * Where the fight is right now — the pad, or the point an arc has reached.
   *
   * It is composed with each section's authored mood by `moodAt`, not substituted for
   * it: the arc keeps its shape and the pad raises or lowers the whole of it. Without
   * this the two are separate channels, and the pad reaches the output only through the
   * genome scalars `deform` biases — every per-note gate in the generators still reads
   * the section's authored urgency and does not move when the fight does.
   */
  mood: Mood;
}

/**
 * The chord sounding at `t` — the last event that has started, or the first if `t`
 * precedes them all.
 *
 * Binary search rather than a scan. Every pitched generator calls this per note and the
 * scan restarted at event zero each time, so the cost grew with the square of the track
 * length: a 64-bar arrangement spent ~38,000 comparisons here to answer 1,200 questions.
 * `Harmony.events` is sorted and gap-free by construction (§5.4), which is what makes the
 * search sound.
 */
export function chordAt(h: Harmony, t: Tick): ChordEvent {
  const events = h.events;
  if (!events.length) throw new Error('chordAt: empty harmony');
  let lo = 0;
  let hi = events.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (events[mid]!.start <= t) lo = mid;
    else hi = mid - 1;
  }
  return events[lo]!;
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
    loopStart: tick(0),
    sections: [{ label: 'A', start: tick(0), length: h.length, mood: NEUTRAL_MOOD }],
  };
}

export const barCount = (h: Harmony, meter: Meter): number =>
  Math.max(1, Math.round(h.length / barTicks(meter)));
